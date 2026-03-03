/**
 * Redis Cache Service
 * 
 * Provides caching for:
 * - Scraped place data (avoid re-scraping)
 * - Search results (query-based caching)
 * - Rate limiting
 * 
 * Note: All methods are designed to fail gracefully if Redis is not available
 */

import Redis from 'ioredis';

class CacheService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.prefix = 'gmap:';
        this.connectionAttempted = false;
    }

    /**
     * Initialize Redis connection
     */
    async connect() {
        if (this.connectionAttempted) return;
        this.connectionAttempted = true;

        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

        try {
            this.client = new Redis(redisUrl, {
                maxRetriesPerRequest: 1,
                retryStrategy: (times) => {
                    // Only retry once, then give up
                    if (times > 1) {
                        return null; // Stop retrying
                    }
                    return 100;
                },
                enableReadyCheck: false,
                lazyConnect: true,
                connectTimeout: 3000,
                showFriendlyErrorStack: false,
            });

            // Suppress error events
            this.client.on('error', (err) => {
                if (!this.isConnected) {
                    // Silently ignore connection errors during startup
                    return;
                }
                console.error('Redis error:', err.message);
            });

            this.client.on('close', () => {
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                this.isConnected = true;
                console.log('✅ Redis connected successfully');
            });

            await this.client.connect();

            // Test the connection
            await this.client.ping();
            this.isConnected = true;

        } catch (error) {
            console.warn('⚠️  Redis not available:', error.message);
            console.warn('   Caching features disabled. Continuing without cache.');
            this.isConnected = false;
            // Clean up failed client
            if (this.client) {
                try {
                    this.client.disconnect();
                } catch {
                    // Ignore
                }
                this.client = null;
            }
        }
    }

    /**
     * Disconnect from Redis
     */
    async disconnect() {
        if (this.client && this.isConnected) {
            await this.client.quit();
            this.isConnected = false;
        }
    }

    /**
     * Generate cache key
     */
    key(type, identifier) {
        return `${this.prefix}${type}:${identifier}`;
    }

    /**
     * Check if a place has been scraped recently
     * @param {string} placeId - Place identifier
     * @returns {Promise<boolean>}
     */
    async isPlaceScraped(placeId) {
        if (!this.isConnected) return false;
        try {
            const exists = await this.client.exists(this.key('place', placeId));
            return exists === 1;
        } catch {
            return false;
        }
    }

    /**
     * Mark place as scraped
     * @param {string} placeId - Place identifier
     * @param {object} data - Place data to cache
     * @param {number} ttl - Time to live in seconds (default 24 hours)
     */
    async setPlaceScraped(placeId, data = {}, ttl = 86400) {
        if (!this.isConnected) return;
        try {
            const key = this.key('place', placeId);
            await this.client.setex(key, ttl, JSON.stringify(data));
        } catch (err) {
            console.error('Cache set error:', err.message);
        }
    }

    /**
     * Get cached place data
     * @param {string} placeId - Place identifier
     * @returns {Promise<object|null>}
     */
    async getPlace(placeId) {
        if (!this.isConnected) return null;
        try {
            const data = await this.client.get(this.key('place', placeId));
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    /**
     * Cache search query results
     * @param {string} query - Search query
     * @param {string} location - Location string
     * @param {array} placeIds - Array of place IDs found
     * @param {number} ttl - Time to live in seconds (default 1 hour)
     */
    async cacheSearchResults(query, location, placeIds, ttl = 3600) {
        if (!this.isConnected) return;
        try {
            const key = this.key('search', `${query}:${location}`.toLowerCase());
            await this.client.setex(key, ttl, JSON.stringify({
                placeIds,
                cachedAt: Date.now(),
                count: placeIds.length,
            }));
        } catch (err) {
            console.error('Cache search error:', err.message);
        }
    }

    /**
     * Get cached search results
     * @param {string} query - Search query
     * @param {string} location - Location string
     * @returns {Promise<object|null>}
     */
    async getCachedSearch(query, location) {
        if (!this.isConnected) return null;
        try {
            const key = this.key('search', `${query}:${location}`.toLowerCase());
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    /**
     * Check rate limit
     * @param {string} identifier - Rate limit identifier
     * @param {number} maxRequests - Max requests allowed
     * @param {number} windowSeconds - Time window in seconds
     * @returns {Promise<boolean>} - True if allowed, false if rate limited
     */
    async checkRateLimit(identifier, maxRequests = 100, windowSeconds = 60) {
        if (!this.isConnected) return true; // Allow if Redis not available

        try {
            const key = this.key('rate', identifier);
            const current = await this.client.incr(key);

            if (current === 1) {
                await this.client.expire(key, windowSeconds);
            }

            return current <= maxRequests;
        } catch {
            return true;
        }
    }

    /**
     * Track scraping statistics
     */
    async incrementStats(type, count = 1) {
        if (!this.isConnected) return;
        try {
            const today = new Date().toISOString().split('T')[0];
            await this.client.hincrby(this.key('stats', today), type, count);
        } catch {
            // Ignore stats errors
        }
    }

    /**
     * Get today's statistics
     */
    async getStats() {
        if (!this.isConnected) return {};
        try {
            const today = new Date().toISOString().split('T')[0];
            return await this.client.hgetall(this.key('stats', today));
        } catch {
            return {};
        }
    }

    /**
     * Store job progress for real-time updates
     */
    async setJobProgress(jobId, progress) {
        if (!this.isConnected) return;
        try {
            await this.client.setex(
                this.key('job', jobId),
                3600,
                JSON.stringify(progress)
            );
        } catch {
            // Ignore
        }
    }

    /**
     * Get job progress
     */
    async getJobProgress(jobId) {
        if (!this.isConnected) return null;
        try {
            const data = await this.client.get(this.key('job', jobId));
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    /**
     * Publish job update to subscribers
     */
    async publishJobUpdate(jobId, data) {
        if (!this.isConnected) return;
        try {
            await this.client.publish('job-updates', JSON.stringify({
                jobId,
                ...data,
            }));
        } catch {
            // Ignore publish errors
        }
    }

    /**
     * Bulk check if places are cached
     * @param {string[]} placeIds - Array of place IDs
     * @returns {Promise<Set<string>>} - Set of cached place IDs
     */
    async getCachedPlaceIds(placeIds) {
        if (!this.isConnected || placeIds.length === 0) return new Set();

        try {
            const keys = placeIds.map(id => this.key('place', id));
            const results = await this.client.mget(...keys);

            const cached = new Set();
            results.forEach((result, index) => {
                if (result) cached.add(placeIds[index]);
            });

            return cached;
        } catch {
            return new Set();
        }
    }

    /**
     * Clear cache for a specific pattern
     */
    async clearCache(pattern) {
        if (!this.isConnected) return;
        try {
            const keys = await this.client.keys(`${this.prefix}${pattern}*`);
            if (keys.length > 0) {
                await this.client.del(...keys);
            }
        } catch (err) {
            console.error('Clear cache error:', err.message);
        }
    }
}

// Singleton instance
const cacheService = new CacheService();

export default cacheService;
