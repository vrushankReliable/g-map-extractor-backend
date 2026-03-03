/**
 * Utility helper functions for the scraper
 */

import config from '../config/index.js';

/**
 * Get a random user agent from the configured list
 * @returns {string} Random user agent string
 */
export const getRandomUserAgent = () => {
    const agents = config.userAgents;
    return agents[Math.floor(Math.random() * agents.length)];
};

/**
 * Generate a random delay within configured bounds with jitter
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {number} Random delay value
 */
export const getRandomDelay = (min = config.scraper.scrollDelayMin, max = config.scraper.scrollDelayMax) => {
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    const jitter = Math.floor(Math.random() * 200) - 100;
    return Math.max(100, base + jitter);
};

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sleep for a random duration within bounds
 * @param {number} min - Minimum delay
 * @param {number} max - Maximum delay
 * @returns {Promise<void>}
 */
export const randomSleep = async (min, max) => {
    const delay = getRandomDelay(min, max);
    await sleep(delay);
};

/**
 * Clean and normalize text extracted from DOM
 * @param {string} text - Raw text to clean
 * @returns {string} Cleaned text
 */
export const cleanText = (text) => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
};

/**
 * Extract coordinates from Google Maps URL
 * @param {string} url - Google Maps URL
 * @returns {object|null} Object with lat, lng or null
 */
export const extractCoordinates = (url) => {
    if (!url) return null;

    const patterns = [
        /@(-?\d+\.\d+),(-?\d+\.\d+)/,
        /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
        /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return {
                latitude: parseFloat(match[1]),
                longitude: parseFloat(match[2]),
            };
        }
    }

    return null;
};

/**
 * Extract place ID from Google Maps URL
 * @param {string} url - Google Maps URL
 * @returns {string|null} Place ID or null
 */
export const extractPlaceId = (url) => {
    if (!url) return null;

    const placeIdMatch = url.match(/place_id[=:]([^&/]+)/i);
    if (placeIdMatch) return placeIdMatch[1];

    const cidMatch = url.match(/[?&]cid=(\d+)/);
    if (cidMatch) return `cid:${cidMatch[1]}`;

    const dataMatch = url.match(/!1s(0x[a-f0-9]+:[a-f0-9x]+)/i);
    if (dataMatch) return dataMatch[1];

    return null;
};

/**
 * Generate unique ID for a business listing
 * @param {object} data - Business data object
 * @returns {string} Unique identifier
 */
export const generateBusinessId = (data) => {
    if (data.placeId) return data.placeId;
    if (data.profileUrl) {
        const placeId = extractPlaceId(data.profileUrl);
        if (placeId) return placeId;
    }
    const composite = `${data.name || ''}_${data.address || ''}_${data.phoneNumber || ''}`;
    return composite.toLowerCase().replace(/[^a-z0-9]/g, '_');
};

/**
 * Validate phone number format
 * @param {string} phone - Phone string to validate
 * @returns {boolean} Whether phone is valid
 */
export const isValidPhone = (phone) => {
    if (!phone || phone === 'N/A') return false;
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
};

/**
 * Format phone number consistently
 * @param {string} phone - Raw phone string
 * @returns {string} Formatted phone or original
 */
export const formatPhone = (phone) => {
    if (!phone || phone === 'N/A') return 'N/A';
    return cleanText(phone);
};

/**
 * Validate and clean URL
 * @param {string} url - URL to validate
 * @returns {string} Valid URL or 'N/A'
 */
export const cleanUrl = (url) => {
    if (!url || url === 'N/A') return 'N/A';
    try {
        const parsed = new URL(url);
        if (['http:', 'https:'].includes(parsed.protocol)) {
            return url;
        }
    } catch {
        return 'N/A';
    }
    return 'N/A';
};

/**
 * Parse rating string to number
 * @param {string} ratingStr - Rating string like "4.5"
 * @returns {number|null} Parsed rating or null
 */
export const parseRating = (ratingStr) => {
    if (!ratingStr || ratingStr === 'N/A') return null;
    const match = ratingStr.match(/(\d+\.?\d*)/);
    if (match) {
        const rating = parseFloat(match[1]);
        if (rating >= 0 && rating <= 5) return rating;
    }
    return null;
};

/**
 * Parse review count string to number
 * @param {string} reviewStr - Review count string like "1,234"
 * @returns {number} Parsed count or 0
 */
export const parseReviewCount = (reviewStr) => {
    if (!reviewStr) return 0;
    const cleaned = reviewStr.replace(/[,\s]/g, '');
    const match = cleaned.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
};

/**
 * Create a deferred promise
 * @returns {object} Object with promise, resolve, reject
 */
export const createDeferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} baseDelay - Base delay between retries
 * @returns {Promise<any>} Result of successful call
 */
export const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                await sleep(delay);
            }
        }
    }

    throw lastError;
};
