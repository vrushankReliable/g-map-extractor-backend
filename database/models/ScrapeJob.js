/**
 * Scrape Job Model
 * 
 * Tracks scraping jobs with status, progress, and results
 */

import mongoose from 'mongoose';

const scrapeJobSchema = new mongoose.Schema({
    // Job identification
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    bullJobId: String,

    // Job type
    type: {
        type: String,
        enum: ['single', 'region', 'batch'],
        default: 'single',
    },

    // Search parameters
    query: {
        type: String,
        required: true,
    },
    keyword: String,
    region: String,
    cities: [String],

    // Job status
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'paused'],
        default: 'pending',
        index: true,
    },

    // Progress tracking
    progress: {
        current: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        percentage: { type: Number, default: 0 },
    },
    tilesCompleted: { type: Number, default: 0 },
    tilesTotal: { type: Number, default: 0 },

    // Results
    resultsCount: { type: Number, default: 0 },
    uniqueResults: { type: Number, default: 0 },
    withPhoneCount: { type: Number, default: 0 },

    // Timing
    startedAt: Date,
    completedAt: Date,
    estimatedEndTime: Date,
    duration: Number, // in seconds

    // Error tracking
    errors: [{
        message: String,
        tileId: String,
        timestamp: Date,
    }],
    lastError: String,
    retryCount: { type: Number, default: 0 },

    // Export
    exportPath: String,
    exportFormat: String,

    // Metadata
    createdBy: String,
    priority: { type: Number, default: 0 },
    options: mongoose.Schema.Types.Mixed,

}, {
    timestamps: true,
    collection: 'scrape_jobs',
});

// Indexes
scrapeJobSchema.index({ status: 1, createdAt: -1 });
scrapeJobSchema.index({ query: 1, status: 1 });

// Methods
scrapeJobSchema.methods.updateProgress = async function (current, total) {
    this.progress.current = current;
    this.progress.total = total;
    this.progress.percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    // Estimate end time
    if (this.startedAt && current > 0) {
        const elapsed = Date.now() - this.startedAt.getTime();
        const rate = current / elapsed;
        const remaining = total - current;
        this.estimatedEndTime = new Date(Date.now() + (remaining / rate));
    }

    await this.save();
};

scrapeJobSchema.methods.complete = async function (stats = {}) {
    this.status = 'completed';
    this.completedAt = new Date();
    this.duration = (this.completedAt - this.startedAt) / 1000;
    this.resultsCount = stats.resultsCount || this.resultsCount;
    this.uniqueResults = stats.uniqueResults || this.uniqueResults;
    this.withPhoneCount = stats.withPhoneCount || this.withPhoneCount;
    this.progress.percentage = 100;
    await this.save();
};

scrapeJobSchema.methods.fail = async function (error) {
    this.status = 'failed';
    this.lastError = error.message || error;
    this.errors.push({
        message: error.message || error,
        timestamp: new Date(),
    });
    this.completedAt = new Date();
    await this.save();
};

scrapeJobSchema.methods.addResult = async function (count = 1, hasPhone = false) {
    this.resultsCount += count;
    if (hasPhone) this.withPhoneCount += 1;
    await this.save();
};

// Statics
scrapeJobSchema.statics.findByJobId = function (jobId) {
    return this.findOne({ jobId });
};

scrapeJobSchema.statics.getActiveJobs = function () {
    return this.find({ status: { $in: ['pending', 'processing'] } })
        .sort({ priority: -1, createdAt: 1 });
};

scrapeJobSchema.statics.getRecentJobs = function (limit = 20) {
    return this.find()
        .sort({ createdAt: -1 })
        .limit(limit);
};

const ScrapeJob = mongoose.model('ScrapeJob', scrapeJobSchema);

export default ScrapeJob;
