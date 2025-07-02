import mongoose from 'mongoose';
import crypto from 'crypto';
import config from '../config/index.js'; // adjust path as needed

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
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  loginCount: { type: Number, default: 0 },
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
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lease', default: [] }]
}, {
  timestamps: true
});

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

userSchema.methods.addSearch = async function (postcode, saveHistory = false) {
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

  if (this.dailySearchCount.count >= config.search.dailyLimit) {
    throw new Error('Daily search limit reached');
  }

  if (saveHistory) {
    this.searchHistory.push({
      postcode,
      timestamp: now,
      saved: true
    });
  }

  this.dailySearchCount.count += 1;
  return this.save();
};

userSchema.methods.getRemainingSearches = function () {
  const now = new Date();
  const lastReset = new Date(this.dailySearchCount.lastReset);

  if (now.getDate() !== lastReset.getDate() ||
    now.getMonth() !== lastReset.getMonth() ||
    now.getFullYear() !== lastReset.getFullYear()) {
    return config.search.dailyLimit;
  }

  return config.search.dailyLimit - this.dailySearchCount.count;
};

userSchema.methods.bookmarkLease = async function (leaseId) {
  if (!this.bookmarks.includes(leaseId)) {
    this.bookmarks.push(leaseId);
    await this.save();
  }
};

userSchema.methods.isLeaseBookmarked = function (leaseId) {
  return this.bookmarks.some(id => id.toString() === leaseId.toString());
};

userSchema.methods.getBookmarkedLeases = async function () {
  return this.populate('bookmarks').then(user => user.bookmarks);
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