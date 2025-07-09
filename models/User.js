import mongoose from 'mongoose';
import crypto from 'crypto';
import config from '../config/index.js'; // adjust path as needed
import Lease from '../models/Lease.js';

const loginSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  ipAddress: String
});

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    lowercase: true,
    trim: true
  },
  guid: {
    type: String,
    unique: true,
    default: () => crypto.randomUUID()
  },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  loginCount: { type: Number, default: 0 },
  leaseViews: { type: Number, default: 0 },
  loginHistory: [loginSchema],
  isVerified: { type: Boolean, default: false },
  verificationCode: {
    code: String,
    expiresAt: Date
  },
  dailySearchCount: {
    count: { type: Number, default: 0 },
    lastReset: { type: Date, default: Date.now }
  },
  bookmarks: [{ type: String, default: [] }] // storing Unique Identifier directly
}, {
  timestamps: true
});

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $ne: null } } });

// ----- Instance Methods -----
userSchema.methods.isInactive = function () {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return this.lastLogin < oneYearAgo;
};

userSchema.methods.anonymize = function () {
  this.email = this.guid;
  this.loginHistory = [];
  return this.save();
};

userSchema.methods.addLogin = async function (ipAddress) {
  this.lastLogin = new Date();
  this.loginCount += 1;
  this.loginHistory.push({ ipAddress });
  return this.save();
};

userSchema.methods.hasCredit = async function (checkOnly = false) {
  const now = new Date();
  const lastReset = new Date(this.dailySearchCount.lastReset);

  // Reset if date has changed
  if (
    now.getDate() !== lastReset.getDate() ||
    now.getMonth() !== lastReset.getMonth() ||
    now.getFullYear() !== lastReset.getFullYear()
  ) {
    this.dailySearchCount = { count: 0, lastReset: now };
  }

  if (this.dailySearchCount.count >= config.search.dailyLimit) {
    return false;
  }

  if (!checkOnly) {
    this.dailySearchCount.count += 1;
    await this.save();
  }

  return true;
};

userSchema.methods.getRemainingSearches = async function () {
  // Trigger a reset check (but don’t increment)
  await this.hasCredit(true);

  return config.search.dailyLimit - this.dailySearchCount.count;
};

userSchema.methods.incrementLeaseViews = async function () {
  this.leaseViews += 1;
  await this.save();
};

// Check if bookmarked
userSchema.methods.isLeaseBookmarked = function(uniqueId) {
  return this.bookmarks.includes(uniqueId);
};

// Add a bookmark
userSchema.methods.bookmarkLease = async function(uniqueId) {
  if (this.bookmarks.includes(uniqueId)) return;

  if (this.bookmarks.length >= config.bookmarks.limit) {
    throw new Error('Bookmark limit reached');
  }

  this.bookmarks.push(uniqueId);
  await this.save();
};

// Get all bookmarked leases (resolve Unique Identifiers to most recent leases)
userSchema.methods.getBookmarkedLeases = async function() {
  const leases = await Lease.aggregate([
    { $match: { 'uid': { $in: this.bookmarks } } },
    { $sort: { 'uid': 1, 'ro': -1 } },
    {
      $group: {
        _id: '$uid',
        lease: { $first: '$$ROOT' }
      }
    },
    { $replaceRoot: { newRoot: '$lease' } }
  ]);
  return Lease.remapLeases(leases);
};

// ----- Static Methods -----
userSchema.statics.cleanupUnverified = async function () {
  const fifteenMinutesAgo = new Date();
  fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);

  return this.deleteMany({
    isVerified: false,
    'verificationCode.expiresAt': { $lt: fifteenMinutesAgo }
  });
};

userSchema.statics.anonymizeInactive = async function () {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const inactiveUsers = await this.find({
    lastLogin: { $lt: oneYearAgo },
    email: { $ne: null }
  });

  for (const user of inactiveUsers) {
    await user.anonymize();
  }
};

// ----- Indexes -----
userSchema.index({ lastLogin: 1 });
userSchema.index({ 'verificationCode.expiresAt': 1 });
userSchema.index({ 'searchHistory.timestamp': 1 });

const User = mongoose.model('User', userSchema);

export default User;