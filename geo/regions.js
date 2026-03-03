// server/geo/regions.js - Predefined region data for India

/**
 * Major cities and areas in Gujarat with their coordinates
 * Used for grid-based extraction to get comprehensive results
 */
export const GUJARAT_CITIES = [
    { name: 'Ahmedabad', lat: 23.0225, lon: 72.5714, radiusKm: 25 },
    { name: 'Surat', lat: 21.1702, lon: 72.8311, radiusKm: 20 },
    { name: 'Vadodara', lat: 22.3072, lon: 73.1812, radiusKm: 15 },
    { name: 'Rajkot', lat: 22.3039, lon: 70.8022, radiusKm: 15 },
    { name: 'Bhavnagar', lat: 21.7645, lon: 72.1519, radiusKm: 10 },
    { name: 'Jamnagar', lat: 22.4707, lon: 70.0577, radiusKm: 10 },
    { name: 'Junagadh', lat: 21.5222, lon: 70.4579, radiusKm: 8 },
    { name: 'Gandhinagar', lat: 23.2156, lon: 72.6369, radiusKm: 10 },
    { name: 'Anand', lat: 22.5645, lon: 72.9289, radiusKm: 8 },
    { name: 'Nadiad', lat: 22.6916, lon: 72.8634, radiusKm: 6 },
    { name: 'Morbi', lat: 22.8173, lon: 70.8378, radiusKm: 6 },
    { name: 'Mehsana', lat: 23.5880, lon: 72.3693, radiusKm: 8 },
    { name: 'Bharuch', lat: 21.7051, lon: 72.9959, radiusKm: 6 },
    { name: 'Vapi', lat: 20.3893, lon: 72.9106, radiusKm: 6 },
    { name: 'Navsari', lat: 20.9467, lon: 72.9520, radiusKm: 6 },
    { name: 'Veraval', lat: 20.9159, lon: 70.3629, radiusKm: 5 },
    { name: 'Porbandar', lat: 21.6417, lon: 69.6293, radiusKm: 5 },
    { name: 'Godhra', lat: 22.7788, lon: 73.6143, radiusKm: 5 },
    { name: 'Palanpur', lat: 24.1725, lon: 72.4381, radiusKm: 5 },
    { name: 'Valsad', lat: 20.5992, lon: 72.9342, radiusKm: 5 },
    { name: 'Surendranagar', lat: 22.7277, lon: 71.6480, radiusKm: 5 },
    { name: 'Amreli', lat: 21.6032, lon: 71.2225, radiusKm: 5 },
    { name: 'Dahod', lat: 22.8379, lon: 74.2548, radiusKm: 5 },
    { name: 'Gandhidham', lat: 23.0753, lon: 70.1337, radiusKm: 6 },
    { name: 'Bhuj', lat: 23.2420, lon: 69.6669, radiusKm: 6 },
];

/**
 * Other Indian states with major cities
 */
export const INDIAN_STATES = {
    'Maharashtra': [
        { name: 'Mumbai', lat: 19.0760, lon: 72.8777, radiusKm: 30 },
        { name: 'Pune', lat: 18.5204, lon: 73.8567, radiusKm: 20 },
        { name: 'Nagpur', lat: 21.1458, lon: 79.0882, radiusKm: 15 },
        { name: 'Thane', lat: 19.2183, lon: 72.9781, radiusKm: 12 },
        { name: 'Nashik', lat: 19.9975, lon: 73.7898, radiusKm: 10 },
        { name: 'Aurangabad', lat: 19.8762, lon: 75.3433, radiusKm: 10 },
    ],
    'Karnataka': [
        { name: 'Bangalore', lat: 12.9716, lon: 77.5946, radiusKm: 25 },
        { name: 'Mysore', lat: 12.2958, lon: 76.6394, radiusKm: 12 },
        { name: 'Hubli', lat: 15.3647, lon: 75.1240, radiusKm: 10 },
        { name: 'Mangalore', lat: 12.9141, lon: 74.8560, radiusKm: 10 },
    ],
    'Tamil Nadu': [
        { name: 'Chennai', lat: 13.0827, lon: 80.2707, radiusKm: 25 },
        { name: 'Coimbatore', lat: 11.0168, lon: 76.9558, radiusKm: 15 },
        { name: 'Madurai', lat: 9.9252, lon: 78.1198, radiusKm: 12 },
        { name: 'Tiruchirappalli', lat: 10.7905, lon: 78.7047, radiusKm: 10 },
    ],
    'Delhi': [
        { name: 'New Delhi', lat: 28.6139, lon: 77.2090, radiusKm: 20 },
        { name: 'Noida', lat: 28.5355, lon: 77.3910, radiusKm: 12 },
        { name: 'Gurgaon', lat: 28.4595, lon: 77.0266, radiusKm: 15 },
        { name: 'Faridabad', lat: 28.4089, lon: 77.3178, radiusKm: 10 },
    ],
    'Rajasthan': [
        { name: 'Jaipur', lat: 26.9124, lon: 75.7873, radiusKm: 20 },
        { name: 'Jodhpur', lat: 26.2389, lon: 73.0243, radiusKm: 12 },
        { name: 'Udaipur', lat: 24.5854, lon: 73.7125, radiusKm: 10 },
        { name: 'Kota', lat: 25.2138, lon: 75.8648, radiusKm: 10 },
    ],
    'Uttar Pradesh': [
        { name: 'Lucknow', lat: 26.8467, lon: 80.9462, radiusKm: 18 },
        { name: 'Kanpur', lat: 26.4499, lon: 80.3319, radiusKm: 15 },
        { name: 'Varanasi', lat: 25.3176, lon: 82.9739, radiusKm: 12 },
        { name: 'Agra', lat: 27.1767, lon: 78.0081, radiusKm: 12 },
        { name: 'Prayagraj', lat: 25.4358, lon: 81.8463, radiusKm: 10 },
    ],
    'West Bengal': [
        { name: 'Kolkata', lat: 22.5726, lon: 88.3639, radiusKm: 25 },
        { name: 'Howrah', lat: 22.5958, lon: 88.2636, radiusKm: 10 },
        { name: 'Durgapur', lat: 23.5204, lon: 87.3119, radiusKm: 8 },
    ],
    'Telangana': [
        { name: 'Hyderabad', lat: 17.3850, lon: 78.4867, radiusKm: 25 },
        { name: 'Warangal', lat: 17.9784, lon: 79.5941, radiusKm: 10 },
        { name: 'Nizamabad', lat: 18.6725, lon: 78.0941, radiusKm: 8 },
    ],
    'Gujarat': GUJARAT_CITIES,
};

/**
 * Parse location query to identify state/region
 */
export function parseLocationQuery(query) {
    const lowerQuery = query.toLowerCase();

    // Check for state names
    for (const [state, cities] of Object.entries(INDIAN_STATES)) {
        if (lowerQuery.includes(state.toLowerCase())) {
            return { type: 'state', name: state, cities };
        }
    }

    // Check for specific city names
    for (const [state, cities] of Object.entries(INDIAN_STATES)) {
        for (const city of cities) {
            if (lowerQuery.includes(city.name.toLowerCase())) {
                return { type: 'city', name: city.name, state, city };
            }
        }
    }

    return null;
}

/**
 * Extract keyword from query (e.g., "restaurants in Gujarat" -> "restaurants")
 */
export function extractKeywordFromQuery(query) {
    // Common patterns: "X in Y", "X near Y", "best X in Y"
    const patterns = [
        /^(best\s+)?(.+?)\s+in\s+.+$/i,
        /^(best\s+)?(.+?)\s+near\s+.+$/i,
        /^(.+?)\s+(at|around|within)\s+.+$/i,
    ];

    for (const pattern of patterns) {
        const match = query.match(pattern);
        if (match) {
            const keyword = match[2] || match[1];
            return keyword.trim();
        }
    }

    // If no pattern matches, use the whole query
    return query;
}

/**
 * Calculate grid cells for a city area
 */
export function calculateGridCells(lat, lon, radiusKm, gridDensity = 3) {
    // 1 degree latitude ≈ 111 km
    const latDegree = radiusKm / 111;
    const lonDegree = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const cells = [];
    const latStep = (latDegree * 2) / gridDensity;
    const lonStep = (lonDegree * 2) / gridDensity;

    for (let i = 0; i < gridDensity; i++) {
        for (let j = 0; j < gridDensity; j++) {
            const minLat = lat - latDegree + i * latStep;
            const maxLat = minLat + latStep;
            const minLon = lon - lonDegree + j * lonStep;
            const maxLon = minLon + lonStep;

            const cellLat = (minLat + maxLat) / 2;
            const cellLon = (minLon + maxLon) / 2;

            cells.push({
                id: `cell-${i}-${j}`,
                lat: cellLat,
                lon: cellLon,
                bounds: { minLat, maxLat, minLon, maxLon },
            });
        }
    }

    return cells;
}

/**
 * Generate search locations for a state/region
 * Returns array of { city, lat, lon, keyword, searchQuery }
 */
export function generateSearchLocations(query) {
    const location = parseLocationQuery(query);
    const keyword = extractKeywordFromQuery(query);

    if (!location) {
        // No recognized location - return single search
        return [{ searchQuery: query, keyword, city: null, lat: null, lon: null }];
    }

    const searches = [];

    if (location.type === 'state') {
        // Search all cities in the state
        for (const city of location.cities) {
            // Generate grid cells for larger cities
            const gridDensity = city.radiusKm > 15 ? 3 : 2;
            const cells = calculateGridCells(city.lat, city.lon, city.radiusKm, gridDensity);

            for (const cell of cells) {
                searches.push({
                    searchQuery: `${keyword} near ${city.name}`,
                    keyword,
                    city: city.name,
                    state: location.name,
                    lat: cell.lat,
                    lon: cell.lon,
                    cellId: cell.id,
                });
            }
        }
    } else if (location.type === 'city') {
        // Search grid cells within the city
        const city = location.city;
        const gridDensity = city.radiusKm > 15 ? 4 : 3;
        const cells = calculateGridCells(city.lat, city.lon, city.radiusKm, gridDensity);

        for (const cell of cells) {
            searches.push({
                searchQuery: `${keyword} near ${city.name}`,
                keyword,
                city: city.name,
                state: location.state,
                lat: cell.lat,
                lon: cell.lon,
                cellId: cell.id,
            });
        }
    }

    return searches;
}

export default {
    GUJARAT_CITIES,
    INDIAN_STATES,
    parseLocationQuery,
    extractKeywordFromQuery,
    calculateGridCells,
    generateSearchLocations,
};
