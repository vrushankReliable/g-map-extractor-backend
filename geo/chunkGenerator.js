/**
 * Geo Chunk Generator Module
 * 
 * Generates geographic tiles/chunks for comprehensive area coverage.
 * Uses coordinate grid tiling with configurable overlap to ensure
 * no businesses are missed at tile boundaries.
 * 
 * Supports:
 * - Lat/Lng bounding box division
 * - City-centric radial expansion
 * - Dynamic grid sizing based on density
 */

import { getRegionData, getCitiesByTier } from './regionData.js';

/**
 * @typedef {Object} GeoTile
 * @property {string} id - Unique tile identifier
 * @property {number} centerLat - Center latitude
 * @property {number} centerLng - Center longitude
 * @property {number} north - Northern boundary
 * @property {number} south - Southern boundary
 * @property {number} east - Eastern boundary
 * @property {number} west - Western boundary
 * @property {string} areaName - Human-readable area name
 * @property {string} cityName - Parent city name
 * @property {number} zoomLevel - Recommended Google Maps zoom level
 * @property {number} priority - Processing priority (higher = process first)
 */

/**
 * @typedef {Object} ChunkingConfig
 * @property {number} gridSizeKm - Size of each grid tile in kilometers
 * @property {number} overlapPercent - Overlap percentage between tiles (0-50)
 * @property {string[]} cityTiers - Which city tiers to include
 * @property {number} cityRadiusKm - Radius around city center to cover
 * @property {boolean} includeRuralAreas - Whether to include rural grid tiles
 */

// Earth's radius in kilometers
const EARTH_RADIUS_KM = 6371;

// Default chunking configuration
const DEFAULT_CONFIG = {
    gridSizeKm: 3,          // 3km x 3km tiles
    overlapPercent: 10,     // 10% overlap between tiles
    cityTiers: ['metro', 'major', 'tier2', 'tier3'],
    cityRadiusKm: 15,       // 15km radius for metro cities
    includeRuralAreas: false,
};

/**
 * Convert kilometers to degrees of latitude
 * @param {number} km - Kilometers
 * @returns {number} Degrees of latitude
 */
function kmToLatDegrees(km) {
    return km / 111.32;
}

/**
 * Convert kilometers to degrees of longitude at a given latitude
 * @param {number} km - Kilometers
 * @param {number} latitude - Latitude in degrees
 * @returns {number} Degrees of longitude
 */
function kmToLngDegrees(km, latitude) {
    const latRad = (latitude * Math.PI) / 180;
    return km / (111.32 * Math.cos(latRad));
}

/**
 * Calculate distance between two coordinates in kilometers
 * @param {number} lat1 - First point latitude
 * @param {number} lng1 - First point longitude
 * @param {number} lat2 - Second point latitude
 * @param {number} lng2 - Second point longitude
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_KM * c;
}

/**
 * Get appropriate zoom level based on tile size
 * @param {number} tileSizeKm - Tile size in kilometers
 * @returns {number} Google Maps zoom level
 */
function getZoomLevel(tileSizeKm) {
    // Approximate mapping of tile size to zoom level
    if (tileSizeKm <= 0.5) return 18;
    if (tileSizeKm <= 1) return 17;
    if (tileSizeKm <= 2) return 16;
    if (tileSizeKm <= 4) return 15;
    if (tileSizeKm <= 8) return 14;
    if (tileSizeKm <= 16) return 13;
    if (tileSizeKm <= 32) return 12;
    return 11;
}

/**
 * Get city-specific radius based on tier and population
 * @param {Object} city - City data object
 * @param {number} baseRadiusKm - Base radius in km
 * @returns {number} Adjusted radius in km
 */
function getCityRadius(city, baseRadiusKm) {
    const tierMultipliers = {
        'metro': 2.5,
        'major': 1.5,
        'tier2': 1.0,
        'tier3': 0.7,
    };

    const multiplier = tierMultipliers[city.tier] || 1.0;
    return baseRadiusKm * multiplier;
}

/**
 * Generate grid tiles around a center point
 * @param {number} centerLat - Center latitude
 * @param {number} centerLng - Center longitude
 * @param {number} radiusKm - Radius to cover in km
 * @param {number} gridSizeKm - Size of each tile in km
 * @param {number} overlapPercent - Overlap percentage
 * @param {string} areaName - Name for the area
 * @returns {GeoTile[]} Array of grid tiles
 */
function generateGridTiles(centerLat, centerLng, radiusKm, gridSizeKm, overlapPercent, areaName) {
    const tiles = [];

    // Calculate step size (accounting for overlap)
    const overlapFactor = 1 - (overlapPercent / 100);
    const stepSizeKm = gridSizeKm * overlapFactor;

    // Convert to degrees
    const latStep = kmToLatDegrees(stepSizeKm);
    const lngStep = kmToLngDegrees(stepSizeKm, centerLat);
    const tileLatSize = kmToLatDegrees(gridSizeKm);
    const tileLngSize = kmToLngDegrees(gridSizeKm, centerLat);

    // Calculate number of steps in each direction
    const stepsLat = Math.ceil(radiusKm / stepSizeKm);
    const stepsLng = Math.ceil(radiusKm / stepSizeKm);

    let tileIndex = 0;

    for (let latOffset = -stepsLat; latOffset <= stepsLat; latOffset++) {
        for (let lngOffset = -stepsLng; lngOffset <= stepsLng; lngOffset++) {
            const tileCenterLat = centerLat + (latOffset * latStep);
            const tileCenterLng = centerLng + (lngOffset * lngStep);

            // Check if this tile is within the radius
            const distanceFromCenter = haversineDistance(
                centerLat, centerLng,
                tileCenterLat, tileCenterLng
            );

            if (distanceFromCenter <= radiusKm) {
                const tile = {
                    id: `${areaName.replace(/\s+/g, '_')}_${tileIndex++}`,
                    centerLat: tileCenterLat,
                    centerLng: tileCenterLng,
                    north: tileCenterLat + (tileLatSize / 2),
                    south: tileCenterLat - (tileLatSize / 2),
                    east: tileCenterLng + (tileLngSize / 2),
                    west: tileCenterLng - (tileLngSize / 2),
                    areaName: `${areaName} Zone ${tileIndex}`,
                    cityName: areaName,
                    zoomLevel: getZoomLevel(gridSizeKm),
                    priority: calculatePriority(distanceFromCenter, radiusKm),
                    distanceFromCenter,
                };

                tiles.push(tile);
            }
        }
    }

    // Sort by priority (center tiles first)
    tiles.sort((a, b) => b.priority - a.priority);

    return tiles;
}

/**
 * Calculate tile priority based on distance from center
 * @param {number} distanceFromCenter - Distance from city center in km
 * @param {number} maxRadius - Maximum radius in km
 * @returns {number} Priority value (higher = process first)
 */
function calculatePriority(distanceFromCenter, maxRadius) {
    // Higher priority for tiles closer to center
    return Math.max(0, 100 - (distanceFromCenter / maxRadius) * 100);
}

/**
 * Generate geographic chunks for an entire region
 * @param {string} regionName - Name of the region (e.g., "Gujarat")
 * @param {ChunkingConfig} [config] - Chunking configuration
 * @returns {Object} Region chunks with metadata
 */
export function generateRegionChunks(regionName, config = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const regionData = getRegionData(regionName);

    if (!regionData) {
        throw new Error(`Unknown region: ${regionName}. Available regions: ${Object.keys(getRegionData()).join(', ')}`);
    }

    const result = {
        region: regionName,
        country: regionData.country,
        bounds: regionData.bounds,
        config: mergedConfig,
        cities: [],
        totalTiles: 0,
        generatedAt: new Date().toISOString(),
    };

    // Get cities based on tier filter
    const cities = getCitiesByTier(regionName, mergedConfig.cityTiers);

    // Generate tiles for each city
    for (const city of cities) {
        const cityRadius = getCityRadius(city, mergedConfig.cityRadiusKm);
        const tiles = generateGridTiles(
            city.lat,
            city.lng,
            cityRadius,
            mergedConfig.gridSizeKm,
            mergedConfig.overlapPercent,
            city.name
        );

        result.cities.push({
            name: city.name,
            lat: city.lat,
            lng: city.lng,
            tier: city.tier,
            population: city.population,
            radiusKm: cityRadius,
            tileCount: tiles.length,
            tiles,
        });

        result.totalTiles += tiles.length;
    }

    // Sort cities by tier priority
    const tierPriority = { 'metro': 4, 'major': 3, 'tier2': 2, 'tier3': 1 };
    result.cities.sort((a, b) => tierPriority[b.tier] - tierPriority[a.tier]);

    return result;
}

/**
 * Generate chunks for a specific city
 * @param {string} cityName - City name
 * @param {number} lat - City latitude
 * @param {number} lng - City longitude
 * @param {ChunkingConfig} [config] - Chunking configuration
 * @returns {GeoTile[]} Array of tiles for the city
 */
export function generateCityChunks(cityName, lat, lng, config = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    return generateGridTiles(
        lat,
        lng,
        mergedConfig.cityRadiusKm,
        mergedConfig.gridSizeKm,
        mergedConfig.overlapPercent,
        cityName
    );
}

/**
 * Generate a single tile for a specific location
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} gridSizeKm - Tile size in km
 * @returns {GeoTile} Single tile
 */
export function generateSingleTile(lat, lng, gridSizeKm = 3) {
    const tileLatSize = kmToLatDegrees(gridSizeKm);
    const tileLngSize = kmToLngDegrees(gridSizeKm, lat);

    return {
        id: `tile_${lat.toFixed(4)}_${lng.toFixed(4)}`,
        centerLat: lat,
        centerLng: lng,
        north: lat + (tileLatSize / 2),
        south: lat - (tileLatSize / 2),
        east: lng + (tileLngSize / 2),
        west: lng - (tileLngSize / 2),
        areaName: `Tile at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        cityName: 'Custom',
        zoomLevel: getZoomLevel(gridSizeKm),
        priority: 100,
        distanceFromCenter: 0,
    };
}

/**
 * Flatten all tiles from a region result into a single array
 * @param {Object} regionChunks - Result from generateRegionChunks
 * @returns {GeoTile[]} Flattened array of all tiles
 */
export function flattenRegionTiles(regionChunks) {
    const allTiles = [];

    for (const city of regionChunks.cities) {
        for (const tile of city.tiles) {
            allTiles.push({
                ...tile,
                regionName: regionChunks.region,
            });
        }
    }

    return allTiles;
}

/**
 * Get tile statistics for a region
 * @param {Object} regionChunks - Result from generateRegionChunks
 * @returns {Object} Statistics object
 */
export function getTileStatistics(regionChunks) {
    const stats = {
        region: regionChunks.region,
        totalCities: regionChunks.cities.length,
        totalTiles: regionChunks.totalTiles,
        byTier: {},
        estimatedCoverage: 0,
    };

    for (const city of regionChunks.cities) {
        if (!stats.byTier[city.tier]) {
            stats.byTier[city.tier] = { cities: 0, tiles: 0 };
        }
        stats.byTier[city.tier].cities++;
        stats.byTier[city.tier].tiles += city.tileCount;

        // Estimate coverage area
        stats.estimatedCoverage += Math.PI * city.radiusKm ** 2;
    }

    stats.estimatedCoverage = Math.round(stats.estimatedCoverage);

    return stats;
}

/**
 * Create a Google Maps viewport URL for a tile
 * @param {GeoTile} tile - Tile object
 * @param {string} keyword - Search keyword
 * @returns {string} Google Maps search URL
 */
export function createTileSearchUrl(tile, keyword) {
    const encodedKeyword = encodeURIComponent(keyword);
    // Using viewport parameters to center the map
    return `https://www.google.com/maps/search/${encodedKeyword}/@${tile.centerLat},${tile.centerLng},${tile.zoomLevel}z`;
}

/**
 * Batch tiles into processing groups
 * @param {GeoTile[]} tiles - Array of tiles
 * @param {number} batchSize - Number of tiles per batch
 * @returns {GeoTile[][]} Array of tile batches
 */
export function batchTiles(tiles, batchSize = 10) {
    const batches = [];

    for (let i = 0; i < tiles.length; i += batchSize) {
        batches.push(tiles.slice(i, i + batchSize));
    }

    return batches;
}

export default {
    generateRegionChunks,
    generateCityChunks,
    generateSingleTile,
    flattenRegionTiles,
    getTileStatistics,
    createTileSearchUrl,
    batchTiles,
    haversineDistance,
    DEFAULT_CONFIG,
};
