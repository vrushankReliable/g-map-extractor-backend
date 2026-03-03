/**
 * Region Data Module
 * 
 * Contains geographic data for Indian states and their major cities.
 * This module provides bounding boxes and city lists for region decomposition.
 * 
 * Data is extensible - add new regions by following the same structure.
 */

/**
 * @typedef {Object} BoundingBox
 * @property {number} north - Northern latitude boundary
 * @property {number} south - Southern latitude boundary
 * @property {number} east - Eastern longitude boundary
 * @property {number} west - Western longitude boundary
 */

/**
 * @typedef {Object} CityData
 * @property {string} name - City name
 * @property {number} lat - Latitude
 * @property {number} lng - Longitude
 * @property {number} population - Approximate population (for prioritization)
 * @property {string} tier - City tier: 'metro', 'major', 'tier2', 'tier3'
 */

/**
 * @typedef {Object} RegionData
 * @property {string} name - Region name
 * @property {string} country - Country name
 * @property {BoundingBox} bounds - Geographic bounding box
 * @property {CityData[]} majorCities - List of major cities
 */

/**
 * Indian States and Union Territories with geographic data
 */
export const INDIAN_REGIONS = {
    'Gujarat': {
        name: 'Gujarat',
        country: 'India',
        bounds: {
            north: 24.7,
            south: 20.1,
            east: 74.5,
            west: 68.1,
        },
        majorCities: [
            { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714, population: 8000000, tier: 'metro' },
            { name: 'Surat', lat: 21.1702, lng: 72.8311, population: 6000000, tier: 'metro' },
            { name: 'Vadodara', lat: 22.3072, lng: 73.1812, population: 2100000, tier: 'major' },
            { name: 'Rajkot', lat: 22.3039, lng: 70.8022, population: 1800000, tier: 'major' },
            { name: 'Bhavnagar', lat: 21.7645, lng: 72.1519, population: 600000, tier: 'tier2' },
            { name: 'Jamnagar', lat: 22.4707, lng: 70.0577, population: 600000, tier: 'tier2' },
            { name: 'Gandhinagar', lat: 23.2156, lng: 72.6369, population: 300000, tier: 'tier2' },
            { name: 'Junagadh', lat: 21.5222, lng: 70.4579, population: 350000, tier: 'tier2' },
            { name: 'Anand', lat: 22.5645, lng: 72.9289, population: 250000, tier: 'tier3' },
            { name: 'Nadiad', lat: 22.6916, lng: 72.8634, population: 225000, tier: 'tier3' },
            { name: 'Morbi', lat: 22.8173, lng: 70.8370, population: 200000, tier: 'tier3' },
            { name: 'Surendranagar', lat: 22.7277, lng: 71.6480, population: 200000, tier: 'tier3' },
            { name: 'Bharuch', lat: 21.7051, lng: 72.9959, population: 180000, tier: 'tier3' },
            { name: 'Mehsana', lat: 23.5880, lng: 72.3693, population: 175000, tier: 'tier3' },
            { name: 'Navsari', lat: 20.9467, lng: 72.9520, population: 180000, tier: 'tier3' },
            { name: 'Valsad', lat: 20.5992, lng: 72.9342, population: 130000, tier: 'tier3' },
            { name: 'Porbandar', lat: 21.6417, lng: 69.6293, population: 150000, tier: 'tier3' },
            { name: 'Godhra', lat: 22.7788, lng: 73.6143, population: 150000, tier: 'tier3' },
            { name: 'Veraval', lat: 20.9159, lng: 70.3629, population: 135000, tier: 'tier3' },
            { name: 'Palanpur', lat: 24.1725, lng: 72.4381, population: 140000, tier: 'tier3' },
            { name: 'Vapi', lat: 20.3893, lng: 72.9106, population: 165000, tier: 'tier3' },
            { name: 'Gandhidham', lat: 23.0753, lng: 70.1337, population: 250000, tier: 'tier3' },
            { name: 'Bhuj', lat: 23.2420, lng: 69.6669, population: 185000, tier: 'tier3' },
        ],
    },

    'Maharashtra': {
        name: 'Maharashtra',
        country: 'India',
        bounds: {
            north: 22.0,
            south: 15.6,
            east: 80.9,
            west: 72.6,
        },
        majorCities: [
            { name: 'Mumbai', lat: 19.0760, lng: 72.8777, population: 20000000, tier: 'metro' },
            { name: 'Pune', lat: 18.5204, lng: 73.8567, population: 7000000, tier: 'metro' },
            { name: 'Nagpur', lat: 21.1458, lng: 79.0882, population: 2800000, tier: 'major' },
            { name: 'Thane', lat: 19.2183, lng: 72.9781, population: 2500000, tier: 'major' },
            { name: 'Nashik', lat: 19.9975, lng: 73.7898, population: 1800000, tier: 'major' },
            { name: 'Aurangabad', lat: 19.8762, lng: 75.3433, population: 1400000, tier: 'major' },
            { name: 'Solapur', lat: 17.6599, lng: 75.9064, population: 1000000, tier: 'tier2' },
            { name: 'Kolhapur', lat: 16.7050, lng: 74.2433, population: 650000, tier: 'tier2' },
            { name: 'Amravati', lat: 20.9320, lng: 77.7523, population: 700000, tier: 'tier2' },
            { name: 'Navi Mumbai', lat: 19.0330, lng: 73.0297, population: 1500000, tier: 'major' },
            { name: 'Sangli', lat: 16.8524, lng: 74.5815, population: 500000, tier: 'tier2' },
            { name: 'Malegaon', lat: 20.5579, lng: 74.5089, population: 500000, tier: 'tier2' },
            { name: 'Jalgaon', lat: 21.0077, lng: 75.5626, population: 500000, tier: 'tier2' },
            { name: 'Akola', lat: 20.7002, lng: 77.0082, population: 450000, tier: 'tier2' },
            { name: 'Latur', lat: 18.4088, lng: 76.5604, population: 400000, tier: 'tier3' },
            { name: 'Dhule', lat: 20.9042, lng: 74.7749, population: 380000, tier: 'tier3' },
            { name: 'Ahmednagar', lat: 19.0948, lng: 74.7480, population: 400000, tier: 'tier3' },
            { name: 'Chandrapur', lat: 19.9615, lng: 79.2961, population: 350000, tier: 'tier3' },
            { name: 'Parbhani', lat: 19.2704, lng: 76.7747, population: 330000, tier: 'tier3' },
            { name: 'Ichalkaranji', lat: 16.6910, lng: 74.4593, population: 300000, tier: 'tier3' },
        ],
    },

    'Karnataka': {
        name: 'Karnataka',
        country: 'India',
        bounds: {
            north: 18.5,
            south: 11.6,
            east: 78.6,
            west: 74.0,
        },
        majorCities: [
            { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, population: 12000000, tier: 'metro' },
            { name: 'Mysuru', lat: 12.2958, lng: 76.6394, population: 1000000, tier: 'major' },
            { name: 'Mangaluru', lat: 12.9141, lng: 74.8560, population: 700000, tier: 'major' },
            { name: 'Hubballi-Dharwad', lat: 15.3647, lng: 75.1240, population: 1100000, tier: 'major' },
            { name: 'Belagavi', lat: 15.8497, lng: 74.4977, population: 600000, tier: 'tier2' },
            { name: 'Kalaburagi', lat: 17.3297, lng: 76.8343, population: 550000, tier: 'tier2' },
            { name: 'Ballari', lat: 15.1394, lng: 76.9214, population: 450000, tier: 'tier2' },
            { name: 'Vijayapura', lat: 16.8302, lng: 75.7100, population: 350000, tier: 'tier2' },
            { name: 'Shivamogga', lat: 13.9299, lng: 75.5681, population: 350000, tier: 'tier2' },
            { name: 'Tumakuru', lat: 13.3392, lng: 77.1017, population: 350000, tier: 'tier3' },
            { name: 'Davanagere', lat: 14.4644, lng: 75.9218, population: 450000, tier: 'tier2' },
            { name: 'Raichur', lat: 16.2120, lng: 77.3439, population: 250000, tier: 'tier3' },
            { name: 'Hassan', lat: 13.0068, lng: 76.1003, population: 180000, tier: 'tier3' },
            { name: 'Udupi', lat: 13.3409, lng: 74.7421, population: 165000, tier: 'tier3' },
        ],
    },

    'Tamil Nadu': {
        name: 'Tamil Nadu',
        country: 'India',
        bounds: {
            north: 13.6,
            south: 8.0,
            east: 80.4,
            west: 76.2,
        },
        majorCities: [
            { name: 'Chennai', lat: 13.0827, lng: 80.2707, population: 11000000, tier: 'metro' },
            { name: 'Coimbatore', lat: 11.0168, lng: 76.9558, population: 2500000, tier: 'major' },
            { name: 'Madurai', lat: 9.9252, lng: 78.1198, population: 1500000, tier: 'major' },
            { name: 'Tiruchirappalli', lat: 10.7905, lng: 78.7047, population: 1000000, tier: 'major' },
            { name: 'Salem', lat: 11.6643, lng: 78.1460, population: 900000, tier: 'major' },
            { name: 'Tirunelveli', lat: 8.7139, lng: 77.7567, population: 500000, tier: 'tier2' },
            { name: 'Tiruppur', lat: 11.1085, lng: 77.3411, population: 900000, tier: 'major' },
            { name: 'Erode', lat: 11.3410, lng: 77.7172, population: 550000, tier: 'tier2' },
            { name: 'Vellore', lat: 12.9165, lng: 79.1325, population: 500000, tier: 'tier2' },
            { name: 'Thoothukudi', lat: 8.7642, lng: 78.1348, population: 400000, tier: 'tier2' },
            { name: 'Thanjavur', lat: 10.7870, lng: 79.1378, population: 300000, tier: 'tier3' },
            { name: 'Dindigul', lat: 10.3673, lng: 77.9803, population: 250000, tier: 'tier3' },
            { name: 'Nagercoil', lat: 8.1833, lng: 77.4119, population: 250000, tier: 'tier3' },
            { name: 'Kanchipuram', lat: 12.8342, lng: 79.7036, population: 180000, tier: 'tier3' },
        ],
    },

    'Rajasthan': {
        name: 'Rajasthan',
        country: 'India',
        bounds: {
            north: 30.2,
            south: 23.0,
            east: 78.2,
            west: 69.5,
        },
        majorCities: [
            { name: 'Jaipur', lat: 26.9124, lng: 75.7873, population: 4000000, tier: 'metro' },
            { name: 'Jodhpur', lat: 26.2389, lng: 73.0243, population: 1400000, tier: 'major' },
            { name: 'Kota', lat: 25.2138, lng: 75.8648, population: 1100000, tier: 'major' },
            { name: 'Bikaner', lat: 28.0229, lng: 73.3119, population: 700000, tier: 'tier2' },
            { name: 'Ajmer', lat: 26.4499, lng: 74.6399, population: 600000, tier: 'tier2' },
            { name: 'Udaipur', lat: 24.5854, lng: 73.7125, population: 500000, tier: 'tier2' },
            { name: 'Bhilwara', lat: 25.3407, lng: 74.6313, population: 400000, tier: 'tier2' },
            { name: 'Alwar', lat: 27.5530, lng: 76.6346, population: 350000, tier: 'tier3' },
            { name: 'Bharatpur', lat: 27.2152, lng: 77.5030, population: 280000, tier: 'tier3' },
            { name: 'Sikar', lat: 27.6094, lng: 75.1399, population: 270000, tier: 'tier3' },
            { name: 'Pali', lat: 25.7711, lng: 73.3234, population: 250000, tier: 'tier3' },
            { name: 'Sri Ganganagar', lat: 29.9038, lng: 73.8772, population: 240000, tier: 'tier3' },
            { name: 'Kishangarh', lat: 26.5876, lng: 74.8536, population: 180000, tier: 'tier3' },
        ],
    },

    'Delhi': {
        name: 'Delhi',
        country: 'India',
        bounds: {
            north: 28.88,
            south: 28.40,
            east: 77.35,
            west: 76.84,
        },
        majorCities: [
            { name: 'New Delhi', lat: 28.6139, lng: 77.2090, population: 20000000, tier: 'metro' },
            { name: 'Dwarka', lat: 28.5921, lng: 77.0460, population: 1500000, tier: 'major' },
            { name: 'Rohini', lat: 28.7495, lng: 77.0565, population: 1000000, tier: 'major' },
            { name: 'Saket', lat: 28.5244, lng: 77.2090, population: 500000, tier: 'tier2' },
            { name: 'Karol Bagh', lat: 28.6519, lng: 77.1909, population: 400000, tier: 'tier2' },
            { name: 'Connaught Place', lat: 28.6315, lng: 77.2167, population: 300000, tier: 'tier2' },
            { name: 'Lajpat Nagar', lat: 28.5677, lng: 77.2433, population: 300000, tier: 'tier2' },
            { name: 'Pitampura', lat: 28.7041, lng: 77.1325, population: 400000, tier: 'tier2' },
            { name: 'Janakpuri', lat: 28.6219, lng: 77.0878, population: 350000, tier: 'tier2' },
            { name: 'Greater Kailash', lat: 28.5494, lng: 77.2340, population: 200000, tier: 'tier3' },
            { name: 'Nehru Place', lat: 28.5480, lng: 77.2530, population: 150000, tier: 'tier3' },
        ],
    },

    'Uttar Pradesh': {
        name: 'Uttar Pradesh',
        country: 'India',
        bounds: {
            north: 30.4,
            south: 23.9,
            east: 84.6,
            west: 77.1,
        },
        majorCities: [
            { name: 'Lucknow', lat: 26.8467, lng: 80.9462, population: 3500000, tier: 'metro' },
            { name: 'Kanpur', lat: 26.4499, lng: 80.3319, population: 3000000, tier: 'metro' },
            { name: 'Ghaziabad', lat: 28.6692, lng: 77.4538, population: 2300000, tier: 'major' },
            { name: 'Agra', lat: 27.1767, lng: 78.0081, population: 1800000, tier: 'major' },
            { name: 'Varanasi', lat: 25.3176, lng: 82.9739, population: 1500000, tier: 'major' },
            { name: 'Meerut', lat: 28.9845, lng: 77.7064, population: 1500000, tier: 'major' },
            { name: 'Prayagraj', lat: 25.4358, lng: 81.8463, population: 1300000, tier: 'major' },
            { name: 'Bareilly', lat: 28.3670, lng: 79.4304, population: 1000000, tier: 'major' },
            { name: 'Aligarh', lat: 27.8974, lng: 78.0880, population: 900000, tier: 'tier2' },
            { name: 'Moradabad', lat: 28.8386, lng: 78.7733, population: 900000, tier: 'tier2' },
            { name: 'Gorakhpur', lat: 26.7606, lng: 83.3732, population: 750000, tier: 'tier2' },
            { name: 'Saharanpur', lat: 29.9680, lng: 77.5510, population: 600000, tier: 'tier2' },
            { name: 'Noida', lat: 28.5355, lng: 77.3910, population: 700000, tier: 'tier2' },
            { name: 'Firozabad', lat: 27.1591, lng: 78.3957, population: 500000, tier: 'tier2' },
            { name: 'Jhansi', lat: 25.4484, lng: 78.5685, population: 500000, tier: 'tier2' },
            { name: 'Muzaffarnagar', lat: 29.4727, lng: 77.7085, population: 400000, tier: 'tier3' },
            { name: 'Mathura', lat: 27.4924, lng: 77.6737, population: 400000, tier: 'tier3' },
            { name: 'Rampur', lat: 28.8155, lng: 79.0250, population: 350000, tier: 'tier3' },
            { name: 'Shahjahanpur', lat: 27.8810, lng: 79.9110, population: 350000, tier: 'tier3' },
        ],
    },

    'West Bengal': {
        name: 'West Bengal',
        country: 'India',
        bounds: {
            north: 27.2,
            south: 21.5,
            east: 89.9,
            west: 85.8,
        },
        majorCities: [
            { name: 'Kolkata', lat: 22.5726, lng: 88.3639, population: 15000000, tier: 'metro' },
            { name: 'Howrah', lat: 22.5958, lng: 88.2636, population: 1200000, tier: 'major' },
            { name: 'Durgapur', lat: 23.5204, lng: 87.3119, population: 600000, tier: 'tier2' },
            { name: 'Asansol', lat: 23.6888, lng: 86.9661, population: 600000, tier: 'tier2' },
            { name: 'Siliguri', lat: 26.7271, lng: 88.6393, population: 700000, tier: 'tier2' },
            { name: 'Bardhaman', lat: 23.2324, lng: 87.8615, population: 350000, tier: 'tier3' },
            { name: 'Malda', lat: 25.0108, lng: 88.1411, population: 200000, tier: 'tier3' },
            { name: 'Baharampur', lat: 24.1024, lng: 88.2517, population: 200000, tier: 'tier3' },
            { name: 'Habra', lat: 22.8300, lng: 88.6500, population: 150000, tier: 'tier3' },
            { name: 'Kharagpur', lat: 22.3460, lng: 87.2320, population: 220000, tier: 'tier3' },
        ],
    },

    'Telangana': {
        name: 'Telangana',
        country: 'India',
        bounds: {
            north: 19.9,
            south: 15.8,
            east: 81.3,
            west: 77.2,
        },
        majorCities: [
            { name: 'Hyderabad', lat: 17.3850, lng: 78.4867, population: 10000000, tier: 'metro' },
            { name: 'Warangal', lat: 17.9689, lng: 79.5941, population: 750000, tier: 'tier2' },
            { name: 'Nizamabad', lat: 18.6725, lng: 78.0941, population: 350000, tier: 'tier3' },
            { name: 'Karimnagar', lat: 18.4386, lng: 79.1288, population: 300000, tier: 'tier3' },
            { name: 'Khammam', lat: 17.2473, lng: 80.1514, population: 300000, tier: 'tier3' },
            { name: 'Ramagundam', lat: 18.7557, lng: 79.4746, population: 250000, tier: 'tier3' },
            { name: 'Mahbubnagar', lat: 16.7488, lng: 77.9855, population: 200000, tier: 'tier3' },
            { name: 'Secunderabad', lat: 17.4399, lng: 78.4983, population: 500000, tier: 'tier2' },
        ],
    },

    'Kerala': {
        name: 'Kerala',
        country: 'India',
        bounds: {
            north: 12.8,
            south: 8.3,
            east: 77.4,
            west: 74.8,
        },
        majorCities: [
            { name: 'Thiruvananthapuram', lat: 8.5241, lng: 76.9366, population: 1000000, tier: 'major' },
            { name: 'Kochi', lat: 9.9312, lng: 76.2673, population: 2100000, tier: 'major' },
            { name: 'Kozhikode', lat: 11.2588, lng: 75.7804, population: 600000, tier: 'tier2' },
            { name: 'Thrissur', lat: 10.5276, lng: 76.2144, population: 350000, tier: 'tier2' },
            { name: 'Kollam', lat: 8.8932, lng: 76.6141, population: 400000, tier: 'tier2' },
            { name: 'Palakkad', lat: 10.7867, lng: 76.6548, population: 200000, tier: 'tier3' },
            { name: 'Alappuzha', lat: 9.4981, lng: 76.3388, population: 175000, tier: 'tier3' },
            { name: 'Kannur', lat: 11.8745, lng: 75.3704, population: 250000, tier: 'tier3' },
            { name: 'Kottayam', lat: 9.5916, lng: 76.5222, population: 200000, tier: 'tier3' },
            { name: 'Malappuram', lat: 11.0510, lng: 76.0711, population: 180000, tier: 'tier3' },
        ],
    },

    'Punjab': {
        name: 'Punjab',
        country: 'India',
        bounds: {
            north: 32.5,
            south: 29.5,
            east: 76.9,
            west: 73.9,
        },
        majorCities: [
            { name: 'Ludhiana', lat: 30.9010, lng: 75.8573, population: 1700000, tier: 'major' },
            { name: 'Amritsar', lat: 31.6340, lng: 74.8723, population: 1200000, tier: 'major' },
            { name: 'Jalandhar', lat: 31.3260, lng: 75.5762, population: 900000, tier: 'major' },
            { name: 'Patiala', lat: 30.3398, lng: 76.3869, population: 450000, tier: 'tier2' },
            { name: 'Bathinda', lat: 30.2110, lng: 74.9455, population: 300000, tier: 'tier2' },
            { name: 'Pathankot', lat: 32.2643, lng: 75.6421, population: 200000, tier: 'tier3' },
            { name: 'Mohali', lat: 30.7046, lng: 76.7179, population: 250000, tier: 'tier3' },
            { name: 'Hoshiarpur', lat: 31.5143, lng: 75.9115, population: 200000, tier: 'tier3' },
            { name: 'Moga', lat: 30.8040, lng: 75.1719, population: 165000, tier: 'tier3' },
        ],
    },

    'Haryana': {
        name: 'Haryana',
        country: 'India',
        bounds: {
            north: 30.9,
            south: 27.4,
            east: 77.6,
            west: 74.5,
        },
        majorCities: [
            { name: 'Faridabad', lat: 28.4089, lng: 77.3178, population: 1500000, tier: 'major' },
            { name: 'Gurgaon', lat: 28.4595, lng: 77.0266, population: 1000000, tier: 'major' },
            { name: 'Panipat', lat: 29.3909, lng: 76.9635, population: 450000, tier: 'tier2' },
            { name: 'Ambala', lat: 30.3782, lng: 76.7767, population: 350000, tier: 'tier2' },
            { name: 'Yamunanagar', lat: 30.1290, lng: 77.2674, population: 300000, tier: 'tier3' },
            { name: 'Rohtak', lat: 28.8955, lng: 76.6066, population: 400000, tier: 'tier2' },
            { name: 'Hisar', lat: 29.1492, lng: 75.7217, population: 350000, tier: 'tier2' },
            { name: 'Karnal', lat: 29.6857, lng: 76.9905, population: 350000, tier: 'tier2' },
            { name: 'Sonipat', lat: 28.9288, lng: 77.0913, population: 300000, tier: 'tier3' },
            { name: 'Panchkula', lat: 30.6942, lng: 76.8606, population: 250000, tier: 'tier3' },
        ],
    },

    'Andhra Pradesh': {
        name: 'Andhra Pradesh',
        country: 'India',
        bounds: {
            north: 19.1,
            south: 12.6,
            east: 84.8,
            west: 76.8,
        },
        majorCities: [
            { name: 'Visakhapatnam', lat: 17.6868, lng: 83.2185, population: 2000000, tier: 'metro' },
            { name: 'Vijayawada', lat: 16.5062, lng: 80.6480, population: 1500000, tier: 'major' },
            { name: 'Guntur', lat: 16.3067, lng: 80.4365, population: 750000, tier: 'tier2' },
            { name: 'Nellore', lat: 14.4426, lng: 79.9865, population: 600000, tier: 'tier2' },
            { name: 'Kurnool', lat: 15.8281, lng: 78.0373, population: 450000, tier: 'tier2' },
            { name: 'Rajahmundry', lat: 17.0005, lng: 81.8040, population: 400000, tier: 'tier2' },
            { name: 'Tirupati', lat: 13.6288, lng: 79.4192, population: 450000, tier: 'tier2' },
            { name: 'Kadapa', lat: 14.4674, lng: 78.8241, population: 350000, tier: 'tier3' },
            { name: 'Kakinada', lat: 16.9891, lng: 82.2475, population: 350000, tier: 'tier3' },
            { name: 'Anantapur', lat: 14.6819, lng: 77.6006, population: 300000, tier: 'tier3' },
            { name: 'Eluru', lat: 16.7107, lng: 81.0952, population: 250000, tier: 'tier3' },
        ],
    },

    'Madhya Pradesh': {
        name: 'Madhya Pradesh',
        country: 'India',
        bounds: {
            north: 26.9,
            south: 21.1,
            east: 82.8,
            west: 74.0,
        },
        majorCities: [
            { name: 'Indore', lat: 22.7196, lng: 75.8577, population: 2200000, tier: 'metro' },
            { name: 'Bhopal', lat: 23.2599, lng: 77.4126, population: 2000000, tier: 'metro' },
            { name: 'Jabalpur', lat: 23.1815, lng: 79.9864, population: 1400000, tier: 'major' },
            { name: 'Gwalior', lat: 26.2183, lng: 78.1828, population: 1200000, tier: 'major' },
            { name: 'Ujjain', lat: 23.1765, lng: 75.7885, population: 500000, tier: 'tier2' },
            { name: 'Sagar', lat: 23.8388, lng: 78.7378, population: 350000, tier: 'tier2' },
            { name: 'Dewas', lat: 22.9676, lng: 76.0534, population: 300000, tier: 'tier3' },
            { name: 'Satna', lat: 24.6005, lng: 80.8322, population: 280000, tier: 'tier3' },
            { name: 'Ratlam', lat: 23.3315, lng: 75.0367, population: 270000, tier: 'tier3' },
            { name: 'Rewa', lat: 24.5362, lng: 81.2940, population: 250000, tier: 'tier3' },
            { name: 'Murwara', lat: 23.8388, lng: 80.3940, population: 230000, tier: 'tier3' },
            { name: 'Singrauli', lat: 24.1994, lng: 82.6753, population: 220000, tier: 'tier3' },
        ],
    },

    'Bihar': {
        name: 'Bihar',
        country: 'India',
        bounds: {
            north: 27.5,
            south: 24.3,
            east: 88.2,
            west: 83.3,
        },
        majorCities: [
            { name: 'Patna', lat: 25.5941, lng: 85.1376, population: 2500000, tier: 'metro' },
            { name: 'Gaya', lat: 24.7914, lng: 85.0002, population: 500000, tier: 'tier2' },
            { name: 'Bhagalpur', lat: 25.2425, lng: 87.0090, population: 450000, tier: 'tier2' },
            { name: 'Muzaffarpur', lat: 26.1209, lng: 85.3647, population: 400000, tier: 'tier2' },
            { name: 'Purnia', lat: 25.7771, lng: 87.4753, population: 350000, tier: 'tier3' },
            { name: 'Darbhanga', lat: 26.1542, lng: 85.8918, population: 350000, tier: 'tier3' },
            { name: 'Bihar Sharif', lat: 25.2010, lng: 85.5240, population: 300000, tier: 'tier3' },
            { name: 'Arrah', lat: 25.5566, lng: 84.6633, population: 280000, tier: 'tier3' },
            { name: 'Begusarai', lat: 25.4182, lng: 86.1272, population: 250000, tier: 'tier3' },
            { name: 'Katihar', lat: 25.5434, lng: 87.5716, population: 240000, tier: 'tier3' },
        ],
    },

    'Odisha': {
        name: 'Odisha',
        country: 'India',
        bounds: {
            north: 22.6,
            south: 17.8,
            east: 87.5,
            west: 81.4,
        },
        majorCities: [
            { name: 'Bhubaneswar', lat: 20.2961, lng: 85.8245, population: 1000000, tier: 'major' },
            { name: 'Cuttack', lat: 20.4625, lng: 85.8830, population: 700000, tier: 'tier2' },
            { name: 'Rourkela', lat: 22.2604, lng: 84.8536, population: 500000, tier: 'tier2' },
            { name: 'Berhampur', lat: 19.3150, lng: 84.7941, population: 400000, tier: 'tier2' },
            { name: 'Sambalpur', lat: 21.4669, lng: 83.9756, population: 250000, tier: 'tier3' },
            { name: 'Puri', lat: 19.8135, lng: 85.8312, population: 200000, tier: 'tier3' },
            { name: 'Balasore', lat: 21.4934, lng: 86.9135, population: 180000, tier: 'tier3' },
            { name: 'Bhadrak', lat: 21.0583, lng: 86.5024, population: 150000, tier: 'tier3' },
        ],
    },
};

/**
 * Get region data by name
 * @param {string} regionName - Name of the region
 * @returns {RegionData|null} Region data or null if not found
 */
export function getRegionData(regionName) {
    const normalizedName = regionName.trim();

    // Direct lookup
    if (INDIAN_REGIONS[normalizedName]) {
        return INDIAN_REGIONS[normalizedName];
    }

    // Case-insensitive lookup
    const lowerName = normalizedName.toLowerCase();
    for (const [key, value] of Object.entries(INDIAN_REGIONS)) {
        if (key.toLowerCase() === lowerName) {
            return value;
        }
    }

    return null;
}

/**
 * Get all available region names
 * @returns {string[]} Array of region names
 */
export function getAvailableRegions() {
    return Object.keys(INDIAN_REGIONS);
}

/**
 * Get cities by tier for a region
 * @param {string} regionName - Name of the region
 * @param {string[]} tiers - Array of tiers to include
 * @returns {CityData[]} Filtered cities
 */
export function getCitiesByTier(regionName, tiers = ['metro', 'major', 'tier2', 'tier3']) {
    const region = getRegionData(regionName);
    if (!region) return [];

    return region.majorCities.filter(city => tiers.includes(city.tier));
}

/**
 * Get metro cities for a region (largest cities)
 * @param {string} regionName - Name of the region
 * @returns {CityData[]} Metro cities
 */
export function getMetroCities(regionName) {
    return getCitiesByTier(regionName, ['metro', 'major']);
}

export default {
    INDIAN_REGIONS,
    getRegionData,
    getAvailableRegions,
    getCitiesByTier,
    getMetroCities,
};
