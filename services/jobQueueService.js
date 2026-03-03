/**
 * BullMQ Job Queue Service
 * 
 * Manages long-running scraping jobs with:
 * - Priority queues
 * - Job retries and backoff
 * - Progress tracking
 * - Concurrency control
 * 
 * Note: Works without Redis by running jobs directly
 */

import { Queue, Worker, QueueEvents } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { GoogleMapsScraper } from '../scraper/googleMapsScraper.js';
import cacheService from './cacheService.js';

// Lazy imports for database to avoid initialization errors
let BusinessLead = null;
let ScrapeJob = null;

async function loadDatabaseModels() {
    if (!BusinessLead || !ScrapeJob) {
        try {
            const db = await import('../database/index.js');
            BusinessLead = db.BusinessLead;
            ScrapeJob = db.ScrapeJob;
        } catch (err) {
            console.warn('Database models not available:', err.message);
        }
    }
}

// Redis connection config with silent failure
const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null, // Don't retry, fail immediately
};

/**
 * Job Queue Manager
 */
class JobQueueService {
    constructor() {
        this.scrapeQueue = null;
        this.worker = null;
        this.queueEvents = null;
        this.isInitialized = false;
        this.queueAvailable = false;
        this.activeJobs = new Map();
        this.eventHandlers = new Map();
    }

    /**
     * Initialize the queue and worker
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load database models
        await loadDatabaseModels();

        try {
            // Create the scraping queue
            this.scrapeQueue = new Queue('scrape-jobs', {
                connection: redisConnection,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: {
                        count: 100,
                        age: 24 * 3600, // 24 hours
                    },
                    removeOnFail: {
                        count: 50,
                    },
                },
            });

            // Wait for connection with timeout
            await Promise.race([
                this.scrapeQueue.waitUntilReady(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Queue connection timeout')), 3000)
                ),
            ]);

            // Create queue events for monitoring
            this.queueEvents = new QueueEvents('scrape-jobs', {
                connection: redisConnection,
            });

            // Set up event listeners
            this.setupEventListeners();

            // Create the worker
            this.worker = new Worker('scrape-jobs', this.processJob.bind(this), {
                connection: redisConnection,
                concurrency: parseInt(process.env.SCRAPE_CONCURRENCY || '2'),
                limiter: {
                    max: 10,
                    duration: 60000, // 10 jobs per minute max
                },
            });

            this.worker.on('completed', this.onJobCompleted.bind(this));
            this.worker.on('failed', this.onJobFailed.bind(this));
            this.worker.on('progress', this.onJobProgress.bind(this));

            this.isInitialized = true;
            this.queueAvailable = true;
            console.log('✅ BullMQ job queue initialized');

        } catch (error) {
            console.warn('⚠️  Job queue not available:', error.message);
            console.warn('   Jobs will run directly without queue.');
            this.isInitialized = true; // Mark as initialized so we don't retry
            this.queueAvailable = false;
            // Clean up any partial initialization
            await this.cleanupFailedInit();
        }
    }

    /**
     * Clean up failed initialization
     */
    async cleanupFailedInit() {
        try {
            if (this.scrapeQueue) {
                await this.scrapeQueue.close().catch(() => { });
                this.scrapeQueue = null;
            }
            if (this.queueEvents) {
                await this.queueEvents.close().catch(() => { });
                this.queueEvents = null;
            }
            if (this.worker) {
                await this.worker.close().catch(() => { });
                this.worker = null;
            }
        } catch {
            // Ignore cleanup errors
        }
    }

    /**
     * Set up queue event listeners
     */
    setupEventListeners() {
        this.queueEvents.on('waiting', ({ jobId }) => {
            console.log(`Job ${jobId} is waiting`);
        });

        this.queueEvents.on('active', ({ jobId }) => {
            console.log(`Job ${jobId} is now active`);
        });

        this.queueEvents.on('stalled', ({ jobId }) => {
            console.log(`Job ${jobId} has stalled`);
        });
    }

    /**
     * Add a scraping job to the queue
     * @param {object} jobData - Job configuration
     * @returns {Promise<object>} - Job info
     */
    async addJob(jobData) {
        await loadDatabaseModels();
        const jobId = jobData.jobId || uuidv4();

        // Create job record in database if available
        let scrapeJob = null;
        if (ScrapeJob) {
            try {
                scrapeJob = new ScrapeJob({
                    jobId,
                    type: jobData.type || 'single',
                    query: jobData.query,
                    keyword: jobData.keyword,
                    region: jobData.region,
                    cities: jobData.cities || [],
                    status: 'pending',
                    options: jobData.options || {},
                    priority: jobData.priority || 0,
                });
                await scrapeJob.save();
            } catch (err) {
                console.warn('Could not save job to database:', err.message);
            }
        }

        // Add to BullMQ queue if available
        if (this.queueAvailable && this.scrapeQueue) {
            const bullJob = await this.scrapeQueue.add(
                jobData.type || 'scrape',
                {
                    ...jobData,
                    jobId,
                    dbJobId: scrapeJob?._id?.toString(),
                },
                {
                    priority: jobData.priority || 0,
                    jobId,
                }
            );

            if (scrapeJob) {
                scrapeJob.bullJobId = bullJob.id;
                await scrapeJob.save();
            }
        } else {
            // Run directly without queue
            this.runDirectJob(jobId, jobData).catch(console.error);
        }

        return {
            jobId,
            status: 'pending',
            message: this.queueAvailable
                ? 'Job added to queue'
                : 'Job started directly (queue not available)',
        };
    }

    /**
     * Run job directly without queue (fallback mode)
     */
    async runDirectJob(jobId, jobData) {
        await loadDatabaseModels();

        let scrapeJob = null;
        if (ScrapeJob) {
            scrapeJob = await ScrapeJob.findByJobId(jobId);
        }

        try {
            if (scrapeJob) {
                scrapeJob.status = 'processing';
                scrapeJob.startedAt = new Date();
                await scrapeJob.save();
            }

            await this.processJob({ id: jobId, data: { ...jobData, jobId } });

        } catch (error) {
            if (scrapeJob) {
                await scrapeJob.fail(error);
            }
            console.error('Direct job failed:', error);
        }
    }

    /**
     * Process a scraping job
     * @param {object} job - BullMQ job object
     */
    async processJob(job) {
        await loadDatabaseModels();
        const { jobId, type, query, keyword, region, options } = job.data;
        console.log(`Processing job ${jobId}: ${type} - "${query}"`);

        let scrapeJob = null;
        if (ScrapeJob) {
            scrapeJob = await ScrapeJob.findByJobId(jobId);
        }

        if (scrapeJob) {
            scrapeJob.status = 'processing';
            scrapeJob.startedAt = new Date();
            await scrapeJob.save();
        }

        let resultsCount = 0;
        let withPhoneCount = 0;

        try {
            // Single query scraping with detail extraction
            const scraper = new GoogleMapsScraper({
                onData: async (place) => {
                    resultsCount++;
                    if (place.phoneNumber && place.phoneNumber !== 'N/A') {
                        withPhoneCount++;
                    }

                    // Save to database
                    await this.savePlace(place, jobId, query);

                    // Update progress
                    await cacheService.setJobProgress(jobId, {
                        resultsCount,
                        withPhoneCount,
                        status: 'processing',
                    });

                    // Report progress to queue
                    if (job.updateProgress) {
                        await job.updateProgress(resultsCount);
                    }
                },
                onProgress: async (progress) => {
                    if (scrapeJob) {
                        try {
                            await scrapeJob.updateProgress(
                                progress.totalFound || 0,
                                progress.totalFound || 100
                            );
                        } catch {
                            // Ignore progress update errors
                        }
                    }
                },
                onComplete: () => { },
                onError: (error) => {
                    console.error(`Job ${jobId} scraping error:`, error);
                },
            });

            await scraper.scrape(query);
            await scraper.cleanup();

            // Mark job as complete
            if (scrapeJob) {
                await scrapeJob.complete({
                    resultsCount,
                    uniqueResults: resultsCount,
                    withPhoneCount,
                });
            }

            await cacheService.incrementStats('jobs_completed');
            await cacheService.incrementStats('leads_scraped', resultsCount);

            console.log(`Job ${jobId} completed: ${resultsCount} results`);

            return { resultsCount, withPhoneCount };

        } catch (error) {
            console.error(`Job ${jobId} failed:`, error);
            if (scrapeJob) {
                await scrapeJob.fail(error);
            }
            throw error;
        }
    }

    /**
     * Save place to database with caching
     */
    async savePlace(place, jobId, searchQuery) {
        try {
            // Check cache first
            if (place.placeId && place.placeId !== 'N/A') {
                const cached = await cacheService.isPlaceScraped(place.placeId);
                if (cached) {
                    await cacheService.incrementStats('cache_hits');
                    return; // Already scraped
                }
            }

            // Only save to database if available
            if (!BusinessLead) {
                // Just cache the place ID
                if (place.placeId && place.placeId !== 'N/A') {
                    await cacheService.setPlaceScraped(place.placeId, {
                        name: place.name,
                        scrapedAt: Date.now(),
                    });
                }
                return;
            }

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

            // Upsert to database
            await BusinessLead.upsertLead({
                ...place,
                placeId: place.placeId !== 'N/A' ? place.placeId : undefined,
                rating: place.rating !== 'N/A' ? parseFloat(place.rating) : undefined,
                reviewCount: place.reviews ? parseInt(place.reviews) : undefined,
                city,
                state,
                searchQuery,
                jobId,
            });

            // Cache the place ID
            if (place.placeId && place.placeId !== 'N/A') {
                await cacheService.setPlaceScraped(place.placeId, {
                    name: place.name,
                    scrapedAt: Date.now(),
                });
            }

            await cacheService.incrementStats('leads_saved');

        } catch (error) {
            // Ignore duplicate key errors
            if (error.code !== 11000) {
                console.error('Save place error:', error.message);
            }
        }
    }

    /**
     * Job completed handler
     */
    async onJobCompleted(job, result) {
        console.log(`Job ${job.id} completed with result:`, result);
        this.emitEvent('completed', { jobId: job.id, result });
    }

    /**
     * Job failed handler
     */
    async onJobFailed(job, error) {
        console.error(`Job ${job.id} failed:`, error.message);
        this.emitEvent('failed', { jobId: job.id, error: error.message });
    }

    /**
     * Job progress handler
     */
    async onJobProgress(job, progress) {
        this.emitEvent('progress', { jobId: job.id, progress });
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        await loadDatabaseModels();

        if (!ScrapeJob) {
            // Return cache-only status if no database
            const cacheProgress = await cacheService.getJobProgress(jobId);
            if (!cacheProgress) return null;
            return {
                jobId,
                status: cacheProgress.status || 'unknown',
                resultsCount: cacheProgress.resultsCount || 0,
                withPhoneCount: cacheProgress.withPhoneCount || 0,
            };
        }

        const dbJob = await ScrapeJob.findByJobId(jobId);
        if (!dbJob) return null;

        const cacheProgress = await cacheService.getJobProgress(jobId);

        return {
            jobId: dbJob.jobId,
            status: dbJob.status,
            type: dbJob.type,
            query: dbJob.query,
            progress: dbJob.progress,
            resultsCount: cacheProgress?.resultsCount || dbJob.resultsCount,
            withPhoneCount: cacheProgress?.withPhoneCount || dbJob.withPhoneCount,
            startedAt: dbJob.startedAt,
            completedAt: dbJob.completedAt,
            duration: dbJob.duration,
            errors: dbJob.errors,
        };
    }

    /**
     * Get all jobs
     */
    async getJobs(options = {}) {
        await loadDatabaseModels();

        if (!ScrapeJob) {
            return { jobs: [], total: 0, page: 1, limit: 20, message: 'Database not available' };
        }

        const { status, limit = 20, page = 1 } = options;

        const query = status ? { status } : {};

        const jobs = await ScrapeJob.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await ScrapeJob.countDocuments(query);

        return { jobs, total, page, limit };
    }

    /**
     * Cancel a job
     */
    async cancelJob(jobId) {
        await loadDatabaseModels();

        // Signal active scraper to stop first
        if (this.activeJobs.has(jobId)) {
            const scraper = this.activeJobs.get(jobId);
            if (scraper.abort) scraper.abort();
            this.activeJobs.delete(jobId);
        }

        if (!ScrapeJob) {
            return { success: true, message: 'Job signalled to cancel' };
        }

        const dbJob = await ScrapeJob.findByJobId(jobId);
        if (!dbJob) return { success: false, message: 'Job not found' };

        if (this.queueAvailable && this.scrapeQueue && dbJob.bullJobId) {
            try {
                const bullJob = await this.scrapeQueue.getJob(dbJob.bullJobId);
                if (bullJob) {
                    await bullJob.remove();
                }
            } catch {
                // Ignore queue errors
            }
        }

        dbJob.status = 'cancelled';
        dbJob.completedAt = new Date();
        await dbJob.save();

        return { success: true, message: 'Job cancelled' };
    }

    /**
     * Retry a failed job
     */
    async retryJob(jobId) {
        await loadDatabaseModels();

        if (!ScrapeJob) {
            return { success: false, message: 'Database not available' };
        }

        const dbJob = await ScrapeJob.findByJobId(jobId);
        if (!dbJob) return { success: false, message: 'Job not found' };

        if (dbJob.status !== 'failed') {
            return { success: false, message: 'Can only retry failed jobs' };
        }

        // Create a new job with same parameters
        return this.addJob({
            type: dbJob.type,
            query: dbJob.query,
            keyword: dbJob.keyword,
            region: dbJob.region,
            cities: dbJob.cities,
            options: dbJob.options,
        });
    }

    /**
     * Event handling
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    emitEvent(event, data) {
        const handlers = this.eventHandlers.get(event) || [];
        handlers.forEach(handler => handler(data));
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        if (!this.queueAvailable || !this.scrapeQueue) {
            return { queueAvailable: false, message: 'Queue not available - jobs run directly' };
        }

        try {
            const [waiting, active, completed, failed] = await Promise.all([
                this.scrapeQueue.getWaitingCount(),
                this.scrapeQueue.getActiveCount(),
                this.scrapeQueue.getCompletedCount(),
                this.scrapeQueue.getFailedCount(),
            ]);

            return {
                queueAvailable: true,
                waiting,
                active,
                completed,
                failed,
            };
        } catch (error) {
            return { queueAvailable: false, error: error.message };
        }
    }

    /**
     * Shutdown gracefully
     */
    async shutdown() {
        console.log('Shutting down job queue...');

        try {
            if (this.worker) {
                await this.worker.close().catch(() => { });
            }
            if (this.scrapeQueue) {
                await this.scrapeQueue.close().catch(() => { });
            }
            if (this.queueEvents) {
                await this.queueEvents.close().catch(() => { });
            }
        } catch (error) {
            console.error('Error during job queue shutdown:', error.message);
        }
    }
}

// Singleton instance
const jobQueueService = new JobQueueService();

export default jobQueueService;
