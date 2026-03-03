/**
 * Business Lead Model
 * 
 * Stores scraped business data with deduplication and indexing
 */

import mongoose from 'mongoose';

const businessLeadSchema = new mongoose.Schema({
    // Unique identifiers
    placeId: {
        type: String,
        index: true,
        sparse: true,
    },
    googleCid: {
        type: String,
        index: true,
        sparse: true,
    },

    // Basic information
    name: {
        type: String,
        required: true,
        index: true,
    },
    category: {
        type: String,
        index: true,
    },
    subcategories: [String],

    // Contact information
    phoneNumber: {
        type: String,
        index: true,
    },
    phoneNumbers: [String], // Multiple phone numbers
    email: String,
    website: String,

    // Location
    address: String,
    fullAddress: String,
    city: {
        type: String,
        index: true,
    },
    state: {
        type: String,
        index: true,
    },
    country: {
        type: String,
        default: 'India',
    },
    postalCode: String,
    latitude: Number,
    longitude: Number,
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            index: '2dsphere',
        },
    },

    // Business details
    rating: Number,
    reviewCount: Number,
    priceLevel: String,
    status: String, // Open, Closed, etc.
    hours: mongoose.Schema.Types.Mixed, // Operating hours

    // URLs
    profileUrl: String,
    mapsUrl: String,

    // Metadata
    source: {
        type: String,
        default: 'Google Maps',
    },
    searchQuery: {
        type: String,
        index: true,
    },
    searchRegion: String,
    tileId: String,
    jobId: {
        type: String,
        index: true,
    },

    // Timestamps
    scrapedAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    lastVerified: Date,

    // Data quality
    hasPhone: {
        type: Boolean,
        default: false,
        index: true,
    },
    hasWebsite: {
        type: Boolean,
        default: false,
    },
    dataComplete: {
        type: Boolean,
        default: false,
    },
    detailsScraped: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true,
    collection: 'business_leads',
});

// Compound indexes for efficient queries
businessLeadSchema.index({ name: 1, address: 1 }, { unique: true, sparse: true });
businessLeadSchema.index({ searchQuery: 1, scrapedAt: -1 });
businessLeadSchema.index({ city: 1, category: 1 });
businessLeadSchema.index({ hasPhone: 1, category: 1 });

// Pre-save middleware
businessLeadSchema.pre('save', function (next) {
    // Set hasPhone flag
    this.hasPhone = !!(this.phoneNumber && this.phoneNumber !== 'N/A');
    this.hasWebsite = !!(this.website && this.website !== 'N/A');

    // Set location for geo queries
    if (this.latitude && this.longitude) {
        this.location = {
            type: 'Point',
            coordinates: [this.longitude, this.latitude],
        };
    }

    // Mark data completeness
    this.dataComplete = this.hasPhone && this.hasWebsite && this.address !== 'N/A';

    this.updatedAt = new Date();
    next();
});

// Static methods
businessLeadSchema.statics.findByPlaceId = function (placeId) {
    return this.findOne({ placeId });
};

businessLeadSchema.statics.findByQuery = function (query, options = {}) {
    const { page = 1, limit = 100, sortBy = 'scrapedAt', sortOrder = -1 } = options;
    return this.find({ searchQuery: new RegExp(query, 'i') })
        .sort({ [sortBy]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit);
};

businessLeadSchema.statics.findNearby = function (lat, lng, radiusKm = 5) {
    return this.find({
        location: {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [lng, lat],
                },
                $maxDistance: radiusKm * 1000,
            },
        },
    });
};

businessLeadSchema.statics.getStats = async function () {
    const stats = await this.aggregate([
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                withPhone: { $sum: { $cond: ['$hasPhone', 1, 0] } },
                withWebsite: { $sum: { $cond: ['$hasWebsite', 1, 0] } },
                complete: { $sum: { $cond: ['$dataComplete', 1, 0] } },
                avgRating: { $avg: '$rating' },
            },
        },
    ]);
    return stats[0] || { total: 0, withPhone: 0, withWebsite: 0, complete: 0 };
};

// Upsert method for deduplication
businessLeadSchema.statics.upsertLead = async function (leadData) {
    const filter = {};

    // Priority: placeId > name+address > phone
    if (leadData.placeId && leadData.placeId !== 'N/A') {
        filter.placeId = leadData.placeId;
    } else if (leadData.name && leadData.address && leadData.address !== 'N/A') {
        filter.name = leadData.name;
        filter.address = leadData.address;
    } else if (leadData.phoneNumber && leadData.phoneNumber !== 'N/A') {
        filter.phoneNumber = leadData.phoneNumber;
    } else {
        filter.name = leadData.name;
    }

    const update = {
        $set: leadData,
        $setOnInsert: { scrapedAt: new Date() },
    };

    return this.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
    });
};

const BusinessLead = mongoose.model('BusinessLead', businessLeadSchema);

export default BusinessLead;
