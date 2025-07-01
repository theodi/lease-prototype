const mongoose = require('mongoose');
const crypto = require('crypto');
const config = require('../config');

const loginSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    ipAddress: String
});

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    guid: {
        type: String,
        unique: true,
        default: () => crypto.randomUUID()
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLogin: {
        type: Date,
        default: Date.now
    },
    loginCount: {
        type: Number,
        default: 0
    },
    loginHistory: [loginSchema],
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationCode: {
        code: String,
        expiresAt: Date
    },
    dailySearchCount: {
        count: { type: Number, default: 0 },
        lastReset: { type: Date, default: Date.now }
    },
    bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lease' }]
}, {
    timestamps: true
});

// Method to check if user is inactive (no login for over a year)
userSchema.methods.isInactive = function() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return this.lastLogin < oneYearAgo;
};

// Method to anonymize inactive user
userSchema.methods.anonymize = function() {
    this.email = this.guid;
    this.loginHistory = [];
    return this.save();
};

// Method to add a new login
userSchema.methods.addLogin = async function(ipAddress) {
    this.lastLogin = new Date();
    this.loginCount += 1;
    this.loginHistory.push({ ipAddress });
    return this.save();
};

// Method to add a search
userSchema.methods.addSearch = async function(postcode, saveHistory = false) {
    // Reset daily count if it's a new day
    const now = new Date();
    const lastReset = new Date(this.dailySearchCount.lastReset);
    if (now.getDate() !== lastReset.getDate() || 
        now.getMonth() !== lastReset.getMonth() || 
        now.getFullYear() !== lastReset.getFullYear()) {
        this.dailySearchCount = {
            count: 0,
            lastReset: now
        };
    }

    // Check if user has searches remaining
    if (this.dailySearchCount.count >= config.search.dailyLimit) {
        throw new Error('Daily search limit reached');
    }

    // Add search to history if user chose to save it
    if (saveHistory) {
        this.searchHistory.push({
            postcode,
            timestamp: now,
            saved: true
        });
    }

    // Increment daily count
    this.dailySearchCount.count += 1;
    return this.save();
};

// Method to get remaining searches
userSchema.methods.getRemainingSearches = function() {
    const now = new Date();
    const lastReset = new Date(this.dailySearchCount.lastReset);
    
    // If it's a new day, reset the count
    if (now.getDate() !== lastReset.getDate() || 
        now.getMonth() !== lastReset.getMonth() || 
        now.getFullYear() !== lastReset.getFullYear()) {
        return config.search.dailyLimit;
    }
    
    return config.search.dailyLimit - this.dailySearchCount.count;
};

// Static method to clean up unverified users
userSchema.statics.cleanupUnverified = async function() {
    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);
    
    return this.deleteMany({
        isVerified: false,
        'verificationCode.expiresAt': { $lt: fifteenMinutesAgo }
    });
};

// Static method to anonymize inactive users
userSchema.statics.anonymizeInactive = async function() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    const inactiveUsers = await this.find({
        lastLogin: { $lt: oneYearAgo },
        email: { $ne: null } // Only process users that haven't been anonymized yet
    });
    
    for (const user of inactiveUsers) {
        await user.anonymize();
    }
};

// Method to bookmark a lease
userSchema.methods.bookmarkLease = async function(leaseId) {
    if (!this.bookmarks.includes(leaseId)) {
        this.bookmarks.push(leaseId);
        await this.save();
    }
};

// Method to check if a lease is bookmarked
userSchema.methods.isLeaseBookmarked = function(leaseId) {
    return this.bookmarks.some(id => id.toString() === leaseId.toString());
};

// Method to get all bookmarked leases
userSchema.methods.getBookmarkedLeases = async function() {
    return this.populate('bookmarks').then(user => user.bookmarks);
};

// Create indexes
userSchema.index({ email: 1 });
userSchema.index({ guid: 1 });
userSchema.index({ lastLogin: 1 });
userSchema.index({ 'verificationCode.expiresAt': 1 });
userSchema.index({ 'searchHistory.timestamp': 1 });

const User = mongoose.model('User', userSchema);

module.exports = User; 