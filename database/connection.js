/**
 * MongoDB Database Connection
 * 
 * Handles connection pooling, reconnection, and graceful shutdown
 */

import mongoose from 'mongoose';
import config from '../config/index.js';

let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connectDatabase() {
    if (isConnected) {
        console.log('Using existing MongoDB connection');
        return mongoose.connection;
    }

    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gmap_scraper';

    try {
        const options = {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        };

        await mongoose.connect(mongoUri, options);
        isConnected = true;

        console.log('✅ MongoDB connected successfully');

        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
            isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB disconnected');
            isConnected = false;
        });

        return mongoose.connection;
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error.message);
        throw error;
    }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectDatabase() {
    if (!isConnected) return;

    try {
        await mongoose.disconnect();
        isConnected = false;
        console.log('MongoDB disconnected gracefully');
    } catch (error) {
        console.error('Error disconnecting from MongoDB:', error);
    }
}

/**
 * Check connection status
 */
export function isDatabaseConnected() {
    return isConnected && mongoose.connection.readyState === 1;
}

export default {
    connect: connectDatabase,
    disconnect: disconnectDatabase,
    isConnected: isDatabaseConnected,
};
