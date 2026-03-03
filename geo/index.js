/**
 * Geo Module Index
 * 
 * Central export point for all geographic utilities.
 */

export { parseQuery, validateQueryForRegionScraping, generateSubAreaQueries, normalizeRegionName, INDIAN_STATES, COUNTRIES } from './queryParser.js';
export { INDIAN_REGIONS, getRegionData, getAvailableRegions, getCitiesByTier, getMetroCities } from './regionData.js';
export {
    generateRegionChunks,
    generateCityChunks,
    generateSingleTile,
    flattenRegionTiles,
    getTileStatistics,
    createTileSearchUrl,
    batchTiles,
    haversineDistance,
    DEFAULT_CONFIG
} from './chunkGenerator.js';

// New grid-based geographic expansion utilities
export {
    GUJARAT_CITIES,
    INDIAN_STATES as STATES_WITH_CITIES,
    parseLocationQuery,
    extractKeywordFromQuery,
    calculateGridCells,
    generateSearchLocations,
} from './regions.js';
