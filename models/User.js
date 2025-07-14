import mongoose from 'mongoose';
import crypto from 'crypto';
import config from '../config/index.js'; // adjust path as needed
import Lease from '../models/Lease.js';
import LeaseTracker from '../models/LeaseTracker.js';
import UserLoginStat from '../models/UserLoginStat.js';

const loginSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  ipAddress: String
}, { _id: false });

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
  bookmarks: [{
    uid: { type: String, required: true },
    versionViewed: { type: String, required: true }, // Format: 'YYYY-MM'
    _id: false
  }],
  receiveLeaseUpdateEmails: {
    type: Boolean,
    default: true
  },
  leaseUpdateEmailsSent: {
    type: [String], // Array of 'YYYY-MM' version strings
    default: []
  },
  lastSarRequestAt: {
    type: Date,
    default: null
  }
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

/*
userSchema.methods.addLogin = async function (ipAddress) {
  this.lastLogin = new Date();
  this.loginCount += 1;
  this.loginHistory.push({ ipAddress });
  return this.save();
};
*/

userSchema.methods.addLogin = async function (ip) {
  const now = new Date();
  const userId = this._id;;

  const formatDate = (date) => date.toISOString().split('T')[0]; // 'YYYY-MM-DD'
  const formatMonth = (date) => date.toISOString().slice(0, 7);   // 'YYYY-MM'
  const formatYear = (date) => date.getFullYear().toString();     // 'YYYY'

  const last = this.lastLogin ? new Date(this.lastLogin) : null;

  const shouldIncrementDay = !last || formatDate(last) !== formatDate(now);
  const shouldIncrementMonth = !last || formatMonth(last) !== formatMonth(now);
  const shouldIncrementYear = !last || formatYear(last) !== formatYear(now);

  const increments = [];

  if (shouldIncrementDay) increments.push(formatDate(now));
  if (shouldIncrementMonth) increments.push(formatMonth(now));
  if (shouldIncrementYear) increments.push(formatYear(now));

  for (const period of increments) {
    await UserLoginStat.findOneAndUpdate(
      { period },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );
  }

  // Update user's last login time and IP
  this.lastLoginAt = now;
  this.lastLoginIp = ip;
  await this.save();
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
  return this.bookmarks.some(b => {
    if (typeof b === 'string') return b === uniqueId; // legacy format
    return b.uid === uniqueId;
  });
};

userSchema.methods.bookmarkLease = async function(uniqueId) {
  const alreadyBookmarked = this.bookmarks.some(b => {
    if (typeof b === 'string') return b === uniqueId;
    return b.uid === uniqueId;
  });

  if (alreadyBookmarked) return;

  if (this.bookmarks.length >= config.bookmarks.limit) {
    throw new Error('Bookmark limit reached');
  }

  const tracker = await LeaseTracker.findOne({ uid: uniqueId }).lean();
  const versionViewed = tracker?.lastUpdated || null;

  this.bookmarks.push({ uid: uniqueId, versionViewed });
  await this.save();
};

// Get all bookmarked leases (resolve Unique Identifiers to most recent leases)
userSchema.methods.getBookmarkedLeases = async function() {
  const uids = this.bookmarks.map(b => typeof b === 'string' ? b : b.uid);

  const leases = await Lease.aggregate([
    { $match: { uid: { $in: uids } } },
    { $sort: { uid: 1, ro: -1 } },
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