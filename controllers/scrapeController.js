/**
 * Scrape Controller
 * 
 * Handles HTTP requests for the scraping API.
 * Implements Server-Sent Events (SSE) for real-time streaming.
 * Supports job queue for long-running scrapes.
 */

import { GoogleMapsScraper } from '../scraper/googleMapsScraper.js';
import { RegionScraper } from '../orchestrator/regionScraper.js';
import { parseQuery, validateQueryForRegionScraping } from '../geo/queryParser.js';
import { getAvailableRegions, getRegionData } from '../geo/regionData.js';
import { generateRegionChunks, getTileStatistics } from '../geo/chunkGenerator.js';
import { BusinessLead, ScrapeJob } from '../database/index.js';
import { cacheService, jobQueueService } from '../services/index.js';
import { parseLocationQuery, generateSearchLocations } from '../geo/regions.js';

const activeSessions = new Map();

/**
 * SSE Streaming scrape endpoint handler
 * GET /api/scrape?query=<search_query>&extractPhones=true&parallelTabs=5
 */
export const streamingScrape = async (req, res) => {
    const { query, extractPhones, parallelTabs } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({
            error: 'Query parameter is required',
            message: 'Please provide a search query (e.g., "restaurants in New York")'
        });
    }

    const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const cleanQuery = query.trim();
    const shouldExtractPhones = extractPhones === 'true' || extractPhones === '1';
    const numParallelTabs = parseInt(parallelTabs) || 5;

    console.log(`[${sessionId}] Starting streaming scrape for: "${cleanQuery}" (extractPhones: ${shouldExtractPhones}, tabs: ${numParallelTabs})`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.write(': connected\n\n');

    let resultCount = 0;
    let isConnectionClosed = false;

    const sendSSE = (event, data) => {
        if (isConnectionClosed) return;
        try {
            if (event) {
                res.write(`event: ${event}\n`);
            }
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error(`[${sessionId}] SSE write error:`, error);
        }
    };

    // Helper function to save place to database
    const saveToDatabase = async (place) => {
        try {
            if (!BusinessLead) return;

            // Parse city/state from address
            let city = '';
            let state = '';
            if (place.address && place.address !== 'N/A') {
                const parts = place.address.split(',').map(p => p.trim());
                if (parts.length >= 2) {
                    city = parts[parts.length - 2] || '';
                    state = parts[parts.length - 1] || '';
                }
            }

            await BusinessLead.upsertLead({
                ...place,
                placeId: place.placeId !== 'N/A' ? place.placeId : undefined,
                rating: place.rating !== 'N/A' ? parseFloat(place.rating) : undefined,
                reviewCount: place.reviews ? parseInt(place.reviews) : undefined,
                city: place.scrapedCity || city,
                state: place.scrapedState || state,
                searchQuery: cleanQuery,
            });
        } catch (error) {
            // Ignore duplicate errors
            if (error.code !== 11000) {
                console.error('Save to DB error:', error.message);
            }
        }
    };

    const scraper = new GoogleMapsScraper({
        onData: async (place) => {
            resultCount++;
            sendSSE(null, {
                type: 'data',
                payload: place,
                count: resultCount,
            });

            // Save to database in background
            saveToDatabase(place).catch(() => { });
        },

        onProgress: (progress) => {
            sendSSE('progress', {
                type: 'progress',
                ...progress,
            });
        },

        onError: (errorMessage) => {
            console.error(`[${sessionId}] Scrape error:`, errorMessage);
            sendSSE('error', {
                type: 'error',
                error: errorMessage,
            });
        },

        onComplete: (stats) => {
            console.log(`[${sessionId}] Scrape completed:`, stats);
            sendSSE('done', {
                type: 'complete',
                ...stats,
            });

            activeSessions.delete(sessionId);

            if (!isConnectionClosed) {
                res.end();
            }
        },
    });

    activeSessions.set(sessionId, {
        scraper,
        query: cleanQuery,
        startTime: Date.now(),
    });

    req.on('close', () => {
        console.log(`[${sessionId}] Client disconnected`);
        isConnectionClosed = true;
        scraper.abort();
        activeSessions.delete(sessionId);
    });

    const keepAliveInterval = setInterval(() => {
        if (!isConnectionClosed) {
            try {
                res.write(': keepalive\n\n');
            } catch {
                clearInterval(keepAliveInterval);
            }
        } else {
            clearInterval(keepAliveInterval);
        }
    }, 15000);

    try {
        // Check if this is a state/region query that needs geo expansion
        const locationInfo = parseLocationQuery(cleanQuery);
        const searchLocations = generateSearchLocations(cleanQuery);

        if (locationInfo && searchLocations.length > 1) {
            // Use geo expansion for state/region-level queries
            console.log(`[${sessionId}] Detected region query - using geo expansion (${searchLocations.length} locations)`);
            sendSSE(null, {
                type: 'info',
                message: `Detected state/region query. Searching ${searchLocations.length} locations for comprehensive results...`,
                locationsCount: searchLocations.length,
                region: locationInfo.name,
            });
            await scraper.scrapeWithGeoExpansion(cleanQuery);
        } else if (shouldExtractPhones) {
            // Use phone extraction with parallel tabs
            console.log(`[${sessionId}] Using phone extraction with ${numParallelTabs} parallel tabs`);
            sendSSE(null, {
                type: 'info',
                message: `Scraping with phone extraction enabled (${numParallelTabs} parallel tabs). This may take longer but will include contact numbers.`,
            });
            await scraper.scrapeWithPhoneExtraction(cleanQuery, { parallelTabs: numParallelTabs });
        } else {
            // Use regular scraping for specific location queries
            await scraper.scrape(cleanQuery);
        }
    } catch (error) {
        console.error(`[${sessionId}] Fatal scrape error:`, error);
        if (!isConnectionClosed) {
            sendSSE('error', {
                type: 'error',
                error: error.message || 'Scraping failed unexpectedly',
            });
            res.end();
        }
    } finally {
        clearInterval(keepAliveInterval);
        activeSessions.delete(sessionId);
    }
};

/**
 * POST /api/scrape - Batch scrape endpoint (non-streaming)
 * Returns all results at once after completion
 */
export const batchScrape = async (req, res) => {
    const { query, maxResults } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({
            error: 'Query is required',
            message: 'Please provide a search query in the request body',
        });
    }

    const cleanQuery = query.trim();
    console.log(`Starting batch scrape for: "${cleanQuery}"`);

    const results = [];
    const limit = maxResults && Number.isInteger(maxResults) ? maxResults : Infinity;

    const scraper = new GoogleMapsScraper({
        onData: (place) => {
            if (results.length < limit) {
                results.push(place);
            } else {
                scraper.abort();
            }
        },
        onError: (error) => {
            console.error('Batch scrape error:', error);
        },
    });

    try {
        await scraper.scrape(cleanQuery);

        res.json({
            success: true,
            query: cleanQuery,
            count: results.length,
            data: results,
            stats: scraper.getStats(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Scraping failed',
            query: cleanQuery,
        });
    }
};

/**
 * GET /api/status - Get active scraping sessions
 */
export const getStatus = (req, res) => {
    const sessions = Array.from(activeSessions.entries()).map(([id, session]) => ({
        sessionId: id,
        query: session.query,
        runningTime: Math.round((Date.now() - session.startTime) / 1000),
        stats: session.scraper.getStats(),
    }));

    res.json({
        activeSessions: sessions.length,
        sessions,
    });
};

/**
 * DELETE /api/scrape/:sessionId - Abort a specific session
 */
export const abortSession = (req, res) => {
    const { sessionId } = req.params;

    const session = activeSessions.get(sessionId);
    if (session) {
        session.scraper.abort();
        activeSessions.delete(sessionId);
        res.json({ success: true, message: 'Session aborted' });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
};

/**
 * GET /api/health - Health check endpoint
 */
export const healthCheck = (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        activeSessions: activeSessions.size,
    });
};

/**
 * GET /api/regions - Get list of available regions for scraping
 */
export const getRegions = (req, res) => {
    const regions = getAvailableRegions();

    const regionDetails = regions.map(name => {
        const data = getRegionData(name);
        return {
            name,
            country: data?.country || 'Unknown',
            citiesCount: data?.majorCities?.length || 0,
        };
    });

    res.json({
        count: regions.length,
        regions: regionDetails,
    });
};

/**
 * POST /api/regions/preview - Preview chunks for a region without scraping
 */
export const previewRegionChunks = (req, res) => {
    const { region, gridSizeKm, cityTiers, cityRadiusKm } = req.body;

    if (!region) {
        return res.status(400).json({
            error: 'Region is required',
            availableRegions: getAvailableRegions(),
        });
    }

    const regionData = getRegionData(region);
    if (!regionData) {
        return res.status(404).json({
            error: `Unknown region: ${region}`,
            availableRegions: getAvailableRegions(),
        });
    }

    try {
        const chunks = generateRegionChunks(region, {
            gridSizeKm: gridSizeKm || 3,
            cityTiers: cityTiers || ['metro', 'major', 'tier2', 'tier3'],
            cityRadiusKm: cityRadiusKm || 15,
        });

        const stats = getTileStatistics(chunks);

        res.json({
            region: chunks.region,
            bounds: chunks.bounds,
            config: chunks.config,
            statistics: stats,
            cities: chunks.cities.map(city => ({
                name: city.name,
                tier: city.tier,
                population: city.population,
                tileCount: city.tileCount,
                // Exclude individual tiles for brevity
            })),
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
};

/**
 * POST /api/scrape/region - Start a region-based scraping session
 * Streams results via SSE
 */
export const scrapeRegion = async (req, res) => {
    const { query, options = {} } = req.body;

    if (!query) {
        return res.status(400).json({
            error: 'Query is required',
            example: 'restaurants in Gujarat',
        });
    }

    // Parse and validate query
    const parsed = parseQuery(query);
    const validation = validateQueryForRegionScraping(parsed);

    if (!validation.isValid) {
        return res.status(400).json({
            error: 'Invalid query for region scraping',
            details: validation.errors,
            parsed,
        });
    }

    // Check region exists
    if (!getRegionData(parsed.region)) {
        return res.status(404).json({
            error: `Unknown region: ${parsed.region}`,
            availableRegions: getAvailableRegions(),
        });
    }

    const sessionId = `region_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[${sessionId}] Starting region scrape for: "${query}"`);

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.write(': connected\n\n');

    let isConnectionClosed = false;

    const sendSSE = (event, data) => {
        if (isConnectionClosed) return;
        try {
            if (event) {
                res.write(`event: ${event}\n`);
            }
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error(`[${sessionId}] SSE write error:`, error);
        }
    };

    // Create region scraper
    const scraper = new RegionScraper({
        headless: options.headless ?? true,
        gridSizeKm: options.gridSizeKm,
        cityTiers: options.cityTiers,
        cityRadiusKm: options.cityRadiusKm,
        maxScrollIdleCount: options.maxScrollIdleCount,

        onData: (place) => {
            sendSSE(null, {
                type: 'data',
                payload: place,
            });
        },

        onProgress: (progress) => {
            sendSSE('progress', {
                type: 'progress',
                ...progress,
            });
        },

        onTileComplete: (result) => {
            sendSSE('tile_complete', {
                type: 'tile_complete',
                tileId: result.tileId,
                success: result.success,
                placesCount: result.placesCount,
            });
        },

        onError: (error) => {
            sendSSE('error', {
                type: 'error',
                ...error,
            });
        },

        onComplete: (results) => {
            sendSSE('done', {
                type: 'complete',
                region: results.region,
                totalResults: results.totalResults,
                totalAreasScanned: results.totalAreasScanned,
                duplicatesRemoved: results.duplicatesRemoved,
                statistics: results.statistics,
            });

            activeSessions.delete(sessionId);

            if (!isConnectionClosed) {
                res.end();
            }
        },
    });

    activeSessions.set(sessionId, {
        scraper,
        query,
        type: 'region',
        startTime: Date.now(),
    });

    // Send session info
    sendSSE('session', {
        type: 'session',
        sessionId,
        query,
        parsed,
    });

    req.on('close', () => {
        console.log(`[${sessionId}] Client disconnected`);
        isConnectionClosed = true;
        scraper.abort();
        activeSessions.delete(sessionId);
    });

    // Keep-alive
    const keepAliveInterval = setInterval(() => {
        if (!isConnectionClosed) {
            try {
                res.write(': keepalive\n\n');
            } catch {
                clearInterval(keepAliveInterval);
            }
        } else {
            clearInterval(keepAliveInterval);
        }
    }, 15000);

    try {
        await scraper.scrape(query);
    } catch (error) {
        console.error(`[${sessionId}] Region scrape error:`, error);
        if (!isConnectionClosed) {
            sendSSE('error', {
                type: 'error',
                fatal: true,
                error: error.message,
            });
            res.end();
        }
    } finally {
        clearInterval(keepAliveInterval);
        activeSessions.delete(sessionId);
    }
};

/**
 * Create a new scraping job (queued)
 * POST /api/jobs
 */
export const createJob = async (req, res) => {
    try {
        const { query, type = 'single', options = {} } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Query is required',
            });
        }

        const result = await jobQueueService.addJob({
            query,
            type,
            options,
        });

        res.json({
            success: true,
            ...result,
        });

    } catch (error) {
        console.error('Create job error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Get job status
 * GET /api/jobs/:jobId
 */
export const getJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;
        const status = await jobQueueService.getJobStatus(jobId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
            });
        }

        res.json({
            success: true,
            job: status,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Get all jobs
 * GET /api/jobs
 */
export const getJobs = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const result = await jobQueueService.getJobs({
            status,
            page: parseInt(page),
            limit: parseInt(limit),
        });

        res.json({
            success: true,
            ...result,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Cancel a job
 * DELETE /api/jobs/:jobId
 */
export const cancelJob = async (req, res) => {
    try {
        const { jobId } = req.params;
        const result = await jobQueueService.cancelJob(jobId);

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Retry a failed job
 * POST /api/jobs/:jobId/retry
 */
export const retryJob = async (req, res) => {
    try {
        const { jobId } = req.params;
        const result = await jobQueueService.retryJob(jobId);

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Get queue statistics
 * GET /api/queue/stats
 */
export const getQueueStats = async (req, res) => {
    try {
        const queueStats = await jobQueueService.getQueueStats();
        const cacheStats = await cacheService.getStats();

        // Return flat structure that frontend expects
        res.json({
            waiting: queueStats?.waiting || 0,
            active: queueStats?.active || 0,
            completed: queueStats?.completed || 0,
            failed: queueStats?.failed || 0,
            delayed: queueStats?.delayed || 0,
            paused: queueStats?.paused || 0,
            available: !!queueStats,
            cache: cacheStats,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Get leads from database
 * GET /api/leads
 */
export const getLeads = async (req, res) => {
    try {
        const {
            query,
            city,
            category,
            hasPhone,
            page = 1,
            limit = 100,
            sortBy = 'scrapedAt',
            sortOrder = 'desc',
        } = req.query;

        const filter = {};
        if (query) filter.searchQuery = new RegExp(query, 'i');
        if (city) filter.city = new RegExp(city, 'i');
        if (category) filter.category = new RegExp(category, 'i');
        if (hasPhone === 'true') filter.hasPhone = true;

        const leads = await BusinessLead.find(filter)
            .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const total = await BusinessLead.countDocuments(filter);
        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            success: true,
            leads,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages,
            pages: totalPages, // backwards compatibility
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Get lead statistics
 * GET /api/leads/stats
 */
export const getLeadStats = async (req, res) => {
    try {
        const stats = await BusinessLead.getStats();

        // Get category breakdown
        const byCategory = await BusinessLead.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
        ]);

        // Get city breakdown
        const byCity = await BusinessLead.aggregate([
            { $match: { city: { $exists: true, $ne: '' } } },
            { $group: { _id: '$city', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
        ]);

        // Count recently added (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentlyAdded = await BusinessLead.countDocuments({
            scrapedAt: { $gte: oneDayAgo }
        });

        // Return in the format frontend expects
        res.json({
            total: stats.total || 0,
            withPhone: stats.withPhone || 0,
            withWebsite: stats.withWebsite || 0,
            byCity,
            byCategory,
            recentlyAdded,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Search leads
 * GET /api/leads/search
 */
export const searchLeads = async (req, res) => {
    try {
        const { q, page = 1, limit = 50 } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                error: 'Search query required',
            });
        }

        const searchRegex = new RegExp(q, 'i');

        const leads = await BusinessLead.find({
            $or: [
                { name: searchRegex },
                { category: searchRegex },
                { address: searchRegex },
                { city: searchRegex },
                { phoneNumber: searchRegex },
            ],
        })
            .sort({ scrapedAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        res.json({
            success: true,
            leads,
            query: q,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Export leads to file
 * POST /api/leads/export
 */
export const exportLeads = async (req, res) => {
    try {
        const { format = 'csv', filter = {} } = req.body;

        const leads = await BusinessLead.find(filter)
            .sort({ scrapedAt: -1 })
            .limit(50000); // Max 50k per export

        if (format === 'csv') {
            const headers = [
                'Name', 'Category', 'Phone', 'Website', 'Address',
                'City', 'State', 'Rating', 'Reviews', 'Latitude', 'Longitude',
            ];

            const rows = leads.map(lead => [
                lead.name,
                lead.category,
                lead.phoneNumber,
                lead.website,
                lead.address,
                lead.city,
                lead.state,
                lead.rating,
                lead.reviewCount,
                lead.latitude,
                lead.longitude,
            ]);

            const BOM = '\uFEFF';
            const csv = BOM + headers.join(',') + '\n' +
                rows.map(row => row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
            res.send(csv);

        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.json"`);
            res.json(leads);
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Get results for a specific job
 * GET /api/jobs/:jobId/results
 */
export const getJobResults = async (req, res) => {
    try {
        const { jobId } = req.params;
        const { page = 1, limit = 100 } = req.query;

        // First try to find leads by jobId
        let leads = await BusinessLead.find({ jobId })
            .sort({ scrapedAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        let total = await BusinessLead.countDocuments({ jobId });

        // If no results by jobId, try to find by the job's search query
        if (total === 0) {
            const job = await ScrapeJob.findOne({ jobId });
            if (job && job.query) {
                // Find leads that match the search query from around the job's creation time
                const queryRegex = new RegExp(job.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                const jobStartTime = job.createdAt || job.startedAt;
                const timeFilter = jobStartTime ? { scrapedAt: { $gte: jobStartTime } } : {};

                leads = await BusinessLead.find({
                    searchQuery: queryRegex,
                    ...timeFilter,
                })
                    .sort({ scrapedAt: -1 })
                    .skip((parseInt(page) - 1) * parseInt(limit))
                    .limit(parseInt(limit));

                total = await BusinessLead.countDocuments({
                    searchQuery: queryRegex,
                    ...timeFilter,
                });
            }
        }

        const totalPages = Math.ceil(total / parseInt(limit));

        // Get phone/website stats
        const withPhone = leads.filter(l => l.hasPhone || (l.phoneNumber && l.phoneNumber !== 'N/A')).length;
        const withWebsite = leads.filter(l => l.hasWebsite || (l.website && l.website !== 'N/A')).length;

        res.json({
            success: true,
            leads,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages,
            stats: {
                total,
                withPhone,
                withWebsite,
            },
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

/**
 * Extract phones for leads without phone numbers
 * POST /api/leads/extract-phones
 */
export const extractPhonesForLeads = async (req, res) => {
    try {
        const { limit = 50, query } = req.body;

        // Find leads without phone numbers
        const filter = {
            $or: [
                { phoneNumber: 'N/A' },
                { phoneNumber: { $exists: false } },
                { hasPhone: false },
            ],
        };

        if (query) {
            filter.searchQuery = new RegExp(query, 'i');
        }

        const leads = await BusinessLead.find(filter)
            .sort({ scrapedAt: -1 })
            .limit(parseInt(limit));

        if (leads.length === 0) {
            return res.json({
                success: true,
                message: 'No leads without phones found',
                processed: 0,
                phonesFound: 0,
            });
        }

        // Start phone extraction in background
        res.json({
            success: true,
            message: `Started phone extraction for ${leads.length} leads`,
            leadsToProcess: leads.length,
        });

        // Background extraction
        const { extractPlaceDetails } = await import('../scraper/detailScraper.js');
        const puppeteer = (await import('puppeteer-extra')).default;

        let phonesFound = 0;
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();

        for (const lead of leads) {
            if (lead.profileUrl && lead.profileUrl !== 'N/A') {
                try {
                    const details = await extractPlaceDetails(page, lead.profileUrl);
                    if (details.phoneNumber && details.phoneNumber !== 'N/A') {
                        lead.phoneNumber = details.phoneNumber;
                        lead.phoneNumbers = details.phoneNumbers;
                        lead.hasPhone = true;
                        await lead.save();
                        phonesFound++;
                        console.log(`Extracted phone for ${lead.name}: ${details.phoneNumber}`);
                    }
                } catch (err) {
                    console.error(`Error extracting phone for ${lead.name}:`, err.message);
                }
            }
        }

        await browser.close();
        console.log(`Phone extraction complete: ${phonesFound}/${leads.length} phones found`);

    } catch (error) {
        console.error('Extract phones error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    }
};

// Default export with all controller methods
export default {
    streamingScrape,
    batchScrape,
    getStatus,
    abortSession,
    healthCheck,
    getRegions,
    previewRegionChunks,
    scrapeRegion,
    createJob,
    getJobStatus,
    getJobs,
    cancelJob,
    retryJob,
    getQueueStats,
    getLeads,
    getLeadStats,
    searchLeads,
    exportLeads,
    getJobResults,
    extractPhonesForLeads,
};
