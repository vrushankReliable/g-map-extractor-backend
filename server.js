/**
 * Google Maps Data Scraper - Main Server Entry Point
 * 
 * Production-grade Express server with:
 * - SSE streaming for real-time results
 * - CORS support for frontend integration
 * - BullMQ job queue for long-running scrapes
 * - MongoDB for data persistence
 * - Redis for caching
 * - Batch and streaming scraping endpoints
 * - Health monitoring
 * 
 * LEGAL DISCLAIMER:
 * This tool scrapes only publicly visible business data from Google Maps.
 * It does NOT bypass any authentication or login mechanisms.
 * It does NOT automate Google account sessions.
 * Users are responsible for ensuring compliance with applicable laws
 * and Google's Terms of Service. Use at your own risk.
 */

import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import {
    streamingScrape,
    batchScrape,
    getStatus,
    abortSession,
    healthCheck,
    getRegions,
    previewRegionChunks,
    scrapeRegion,
    // Job Queue endpoints
    createJob,
    getJobStatus,
    getJobs,
    cancelJob,
    retryJob,
    getQueueStats,
    getJobResults,
    // Database endpoints
    getLeads,
    getLeadStats,
    searchLeads,
    exportLeads,
    extractPhonesForLeads,
} from './controllers/scrapeController.js';
import { connectDatabase, disconnectDatabase } from './database/index.js';
import { cacheService, jobQueueService } from './services/index.js';

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

app.get('/api/health', healthCheck);

app.get('/api/scrape', streamingScrape);

app.post('/api/scrape', batchScrape);

app.get('/api/status', getStatus);

app.delete('/api/scrape/:sessionId', abortSession);

// Region-based scraping endpoints
app.get('/api/regions', getRegions);

app.post('/api/regions/preview', previewRegionChunks);

app.post('/api/scrape/region', scrapeRegion);

// Job Queue endpoints
app.post('/api/jobs', createJob);

app.get('/api/jobs', getJobs);

app.get('/api/jobs/:jobId', getJobStatus);

app.delete('/api/jobs/:jobId', cancelJob);

app.post('/api/jobs/:jobId/retry', retryJob);

app.get('/api/jobs/:jobId/results', getJobResults);

app.get('/api/queue/stats', getQueueStats);

// Database/Leads endpoints
app.get('/api/leads', getLeads);

app.get('/api/leads/stats', getLeadStats);

app.get('/api/leads/search', searchLeads);

app.post('/api/leads/export', exportLeads);

app.post('/api/leads/extract-phones', extractPhonesForLeads);

app.get('/', (req, res) => {
    res.json({
        name: 'Google Maps Data Scraper API',
        version: '2.0.0',
        endpoints: {
            'GET /api/health': 'Health check',
            'GET /api/scrape?query=<search>': 'Stream scraping results via SSE',
            'POST /api/scrape': 'Batch scrape with JSON body { query, maxResults? }',
            'GET /api/status': 'Get active scraping sessions',
            'DELETE /api/scrape/:sessionId': 'Abort a specific scraping session',
            'GET /api/regions': 'List available regions for geographic scraping',
            'POST /api/regions/preview': 'Preview chunk statistics for a region',
            'POST /api/scrape/region': 'Start region-based scraping with geographic chunking',
        },
        documentation: 'Send a search query to start scraping Google Maps business listings.',
        regionScraping: {
            description: 'For comprehensive region-based scraping with geographic chunking',
            example: 'POST /api/scrape/region with { query: "restaurants in Gujarat" }',
        },
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} does not exist`,
    });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: config.server.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
    });
});

const PORT = config.server.port;

/**
 * Initialize services and start server
 */
async function startServer() {
    try {
        // Connect to MongoDB (optional - continues without if not available)
        try {
            await connectDatabase();
        } catch (err) {
            console.warn('⚠️  MongoDB not available:', err.message);
            console.warn('   Database features disabled. Running in memory-only mode.');
        }

        // Connect to Redis (optional - continues without if not available)
        try {
            await cacheService.connect();
        } catch (err) {
            console.warn('⚠️  Redis not available:', err.message);
            console.warn('   Caching features disabled.');
        }

        // Initialize job queue (optional - continues without if not available)
        try {
            await jobQueueService.initialize();
        } catch (err) {
            console.warn('⚠️  Job queue not available:', err.message);
            console.warn('   Jobs will run directly without queue.');
        }

        // Start HTTP server
        app.listen(PORT, () => {
            console.log('========================================');
            console.log('  Google Maps Data Scraper Server');
            console.log('========================================');
            console.log(`  Environment: ${config.server.nodeEnv}`);
            console.log(`  Port: ${PORT}`);
            console.log(`  Headless: ${config.puppeteer.headless}`);
            console.log(`  Stealth Mode: ${config.scraper.enableStealth}`);
            console.log('========================================');
            console.log(`  API: http://localhost:${PORT}`);
            console.log(`  Health: http://localhost:${PORT}/api/health`);
            console.log('========================================');
            console.log('');
            console.log('Features enabled:');
            console.log(`  ✓ SSE Streaming`);
            console.log(`  ✓ Region-based Scraping`);
            console.log(`  ✓ Deep Phone Extraction`);
            console.log('');
            console.log('LEGAL NOTICE: This tool scrapes only publicly');
            console.log('visible data. Users must comply with applicable');
            console.log('laws and terms of service.');
            console.log('');
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    try {
        await jobQueueService.shutdown();
        await cacheService.disconnect();
        await disconnectDatabase();
        console.log('All services disconnected.');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export default app;
