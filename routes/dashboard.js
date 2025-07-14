import express from 'express';
import Lease from '../models/Lease.js';
import User from '../models/User.js';
import LeaseUpdateLog from '../models/LeaseUpdateLog.js';
import LeaseViewStat from '../models/LeaseViewStat.js';
import SearchAnalytics from '../models/SearchAnalytics.js';
import config from '../config/index.js';
import UserLoginStat from '../models/UserLoginStat.js';
import BugReport from '../models/BugReport.js';

const router = express.Router();

const requireVerifiedEmail = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');
  next();
};

const requireAdminDomain = async (req, res, next) => {
  try {
    const allowedDomains = config.allowedDomains; // already an array
    const user = await User.findById(req.session.userId).lean(); // .lean() is optional
    if (!user || !user.email) {
      return res.status(403).render('error', { error: 'Access denied – user not found.' });
    }

    const domain = user.email.split('@')[1]?.toLowerCase();

    if (allowedDomains.includes(domain)) {
      return next();
    }

    return res.status(403).render('error', { error: 'Access denied – not an authorised domain.' });
  } catch (err) {
    console.error('Error in requireAdminDomain middleware:', err);
    return res.status(500).render('error', { error: 'Internal server error.' });
  }
};

router.get('/dashboard', requireVerifiedEmail, requireAdminDomain, async (req, res) => {
  try {
    const [
      leaseCount,
      userCount,
      bugCount,
      latestUpdate,
      topLeasesAllTime,
      topLeasesLastMonth,
      searchStats
    ] = await Promise.all([
      Lease.estimatedDocumentCount(),
      User.countDocuments(),
      BugReport.countDocuments(),
      LeaseUpdateLog.findOne().sort({ version: -1 }).lean(),
      LeaseViewStat.find().sort({ viewCount: -1 }).limit(10).lean(),
      LeaseViewStat.find({ lastViewedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } })
        .sort({ viewCount: -1 }).limit(10).lean(),
      SearchAnalytics.find().sort({ count: -1 }).lean()
    ]);

    // Get Register Property Descriptions for the top viewed leases
    const uniqueIds = Array.from(new Set([
      ...topLeasesAllTime.map(l => l.uniqueId),
      ...topLeasesLastMonth.map(l => l.uniqueId)
    ]));

    const leases = await Lease.find({ uid: { $in: uniqueIds } }).lean();
    const leaseMap = new Map(leases.map(l => [l.uid, l['rpd']]));

    const today = new Date();
    const dailyStats = [];

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const id = date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
        const stat = await UserLoginStat.findOne({ period: id }).lean();
        dailyStats.push({ label: id, value: stat?.count || 0 });
    }
    const monthlyStats = [];

    for (let i = 11; i >= 0; i--) {
        const date = new Date(today);
        date.setMonth(today.getMonth() - i);
        const id = date.toISOString().slice(0, 7); // 'YYYY-MM'
        const stat = await UserLoginStat.findOne({ period: id }).lean();
        monthlyStats.push({ label: id, value: stat?.count || 0 });
    }

    const currentYear = today.getFullYear();
    const yearlyStats = [];

    for (let i = 0; i < 10; i++) {
        const year = (currentYear - (9 - i)).toString();
        const stat = await UserLoginStat.findOne({ period: year }).lean();
        yearlyStats.push({ label: year, value: stat?.count || 0 });
    }

    res.render('dashboard', {
      email: req.session.userEmail,
      leaseCount,
      userCount,
      bugCount,
      latestUpdate,
      topLeasesAllTime,
      topLeasesLastMonth,
      leaseMap,
      searchStats,
      dailyStats,
      monthlyStats,
      yearlyStats
    });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.status(500).render('error', { error: 'Unable to load admin dashboard' });
  }
});

export default router;