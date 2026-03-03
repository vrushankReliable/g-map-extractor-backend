/**
 * Query Parser Module
 * 
 * Parses user queries to extract search terms and geographic regions.
 * Detects region keywords and prepares them for hierarchical decomposition.
 * 
 * Example: "restaurants in Gujarat" -> { keyword: "restaurants", region: "Gujarat" }
 */

// Common region patterns in various formats
const REGION_PATTERNS = [
    // "in <region>" pattern
    /^(.+?)\s+in\s+(.+)$/i,
    // "<region> <keyword>" pattern  
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(.+)$/,
    // "near <region>" pattern
    /^(.+?)\s+near\s+(.+)$/i,
    // "around <region>" pattern
    /^(.+?)\s+around\s+(.+)$/i,
];

// Known Indian states and union territories for quick detection
const INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
    'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
    'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli', 'Daman and Diu',
    'Lakshadweep',
];

// Known country names for country-level searches
const COUNTRIES = [
    'India', 'USA', 'United States', 'UK', 'United Kingdom', 'Canada',
    'Australia', 'Germany', 'France', 'Japan', 'China', 'Brazil',
    'South Africa', 'UAE', 'United Arab Emirates', 'Singapore', 'Indonesia',
    'Malaysia', 'Thailand', 'Vietnam', 'Philippines', 'Saudi Arabia',
    'Pakistan', 'Bangladesh', 'Nepal', 'Sri Lanka',
];

/**
 * Parsed query result structure
 * @typedef {Object} ParsedQuery
 * @property {string} keyword - The search keyword (e.g., "restaurants")
 * @property {string} region - The geographic region (e.g., "Gujarat")
 * @property {string} regionType - Type of region: 'state', 'country', 'city', 'custom'
 * @property {string} originalQuery - The original query string
 * @property {boolean} isRegionQuery - Whether this is a region-based query
 */

/**
 * Parse a search query to extract keyword and region
 * @param {string} query - Raw user query
 * @returns {ParsedQuery} Parsed query object
 */
export function parseQuery(query) {
    if (!query || typeof query !== 'string') {
        throw new Error('Query must be a non-empty string');
    }

    const trimmedQuery = query.trim();

    // Try to match against region patterns
    for (const pattern of REGION_PATTERNS) {
        const match = trimmedQuery.match(pattern);
        if (match) {
            const [, keyword, region] = match;
            const regionType = detectRegionType(region.trim());

            return {
                keyword: keyword.trim(),
                region: region.trim(),
                regionType,
                originalQuery: trimmedQuery,
                isRegionQuery: true,
            };
        }
    }

    // Check if query contains a known state/country name
    const knownRegion = findKnownRegion(trimmedQuery);
    if (knownRegion) {
        const keyword = trimmedQuery
            .replace(new RegExp(knownRegion.name, 'gi'), '')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            keyword: keyword || trimmedQuery,
            region: knownRegion.name,
            regionType: knownRegion.type,
            originalQuery: trimmedQuery,
            isRegionQuery: !!keyword && keyword !== trimmedQuery,
        };
    }

    // Default: treat entire query as keyword, no region
    return {
        keyword: trimmedQuery,
        region: null,
        regionType: null,
        originalQuery: trimmedQuery,
        isRegionQuery: false,
    };
}

/**
 * Detect the type of a region
 * @param {string} region - Region name
 * @returns {string} Region type
 */
function detectRegionType(region) {
    const normalizedRegion = region.toLowerCase();

    // Check against known Indian states
    for (const state of INDIAN_STATES) {
        if (state.toLowerCase() === normalizedRegion) {
            return 'state';
        }
    }

    // Check against known countries
    for (const country of COUNTRIES) {
        if (country.toLowerCase() === normalizedRegion) {
            return 'country';
        }
    }

    // If it's short and capitalized, likely a city
    if (region.length < 20 && /^[A-Z]/.test(region)) {
        return 'city';
    }

    return 'custom';
}

/**
 * Find a known region in the query
 * @param {string} query - Query string
 * @returns {Object|null} Found region with name and type
 */
function findKnownRegion(query) {
    const normalizedQuery = query.toLowerCase();

    // Check Indian states first
    for (const state of INDIAN_STATES) {
        if (normalizedQuery.includes(state.toLowerCase())) {
            return { name: state, type: 'state' };
        }
    }

    // Check countries
    for (const country of COUNTRIES) {
        if (normalizedQuery.includes(country.toLowerCase())) {
            return { name: country, type: 'country' };
        }
    }

    return null;
}

/**
 * Validate a parsed query for region scraping
 * @param {ParsedQuery} parsedQuery - Parsed query object
 * @returns {Object} Validation result with isValid and errors
 */
export function validateQueryForRegionScraping(parsedQuery) {
    const errors = [];

    if (!parsedQuery.keyword) {
        errors.push('Search keyword is required');
    }

    if (!parsedQuery.region) {
        errors.push('Region is required for geographic chunking');
    }

    if (parsedQuery.keyword && parsedQuery.keyword.length < 2) {
        errors.push('Search keyword must be at least 2 characters');
    }

    if (parsedQuery.region && parsedQuery.region.length < 2) {
        errors.push('Region name must be at least 2 characters');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Generate search queries for a region's sub-areas
 * @param {string} keyword - Search keyword
 * @param {string[]} subAreas - Array of sub-area names
 * @returns {string[]} Array of search queries
 */
export function generateSubAreaQueries(keyword, subAreas) {
    return subAreas.map(area => `${keyword} in ${area}`);
}

/**
 * Normalize a region name for consistent lookups
 * @param {string} region - Region name
 * @returns {string} Normalized region name
 */
export function normalizeRegionName(region) {
    if (!region) return '';

    return region
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export default {
    parseQuery,
    validateQueryForRegionScraping,
    generateSubAreaQueries,
    normalizeRegionName,
    INDIAN_STATES,
    COUNTRIES,
};
