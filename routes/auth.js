// routes/auth.js
import express from 'express';
import User from '../models/User.js';
import Lease from '../models/Lease.js';
import LeaseUpdateLog from '../models/LeaseUpdateLog.js';
import LeaseTracker from '../models/LeaseTracker.js';

const router = express.Router();

const requireVerifiedEmail = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');
  next();
};

// Main app page
router.get('/app', requireVerifiedEmail, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const remainingSearches = await user.getRemainingSearches();
    const leases = await user.getBookmarkedLeases();
    const bookmarkMap = new Map(
      user.bookmarks.map(b => [typeof b === 'string' ? b : b.uid, b.versionViewed || null])
    );

    const trackedVersions = await LeaseTracker.find({
      uid: { $in: leases.map(l => l['Unique Identifier']) }
    }).lean();

    const trackerMap = new Map(trackedVersions.map(t => [t.uid, t.lastUpdated]));

    // Enrich leases with version tracking info
    const bookmarkedLeases = leases.map(lease => {
      const uid = lease['Unique Identifier'];
      const viewed = bookmarkMap.get(uid);
      const latest = trackerMap.get(uid);
      const isStale = latest && viewed && latest !== viewed;

      return {
        ...lease,
        versionViewed: viewed,
        versionLatest: latest,
        isStale
      };
    });

    // Recently viewed leases (from session)
    const recentlyViewedIds = (req.session.searchedLeases || []).reverse(); // limit to last 5, newest first

    const recentlyViewedLeases = recentlyViewedIds.length
      ? await Lease.aggregate([
          { $match: { uid: { $in: recentlyViewedIds } } },
          { $sort: { ro: -1 } }, // pick latest version of each
          {
            $group: {
              _id: '$uid',
              lease: { $first: '$$ROOT' }
            }
          },
          { $replaceRoot: { newRoot: '$lease' } },
          { $project: {
              uid: 1,
              rpd: 1,
              apd: 1,
              pc: 1
            }
          }
        ])
      : [];

    const latestVersion = await LeaseUpdateLog.getLatestVersion();

    res.render('app', {
      email: user.email,
      remainingSearches,
      bookmarkedLeases,
      recentlyViewedLeases,
      latestVersion
    });
  } catch (error) {
    console.error('Error loading app page:', error);
    res.status(500).render('error', { error: 'Failed to load application' });
  }
});
// Logout route
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).render('error', { error: 'Failed to log out' });
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// Profile page (GET)
router.get('/profile', requireVerifiedEmail, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    res.render('profile', {
      email: user.email,
      receiveLeaseUpdateEmails: user.receiveLeaseUpdateEmails !== false // treat undefined as true
    });
  } catch (err) {
    console.error('Error loading profile:', err);
    res.status(500).render('error', { error: 'Failed to load profile' });
  }
});

// Profile update (POST)
router.post('/profile', requireVerifiedEmail, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    user.receiveLeaseUpdateEmails = !!req.body.receiveLeaseUpdateEmails; // checkbox on = true
    await user.save();
    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).render('error', { error: 'Failed to update preferences' });
  }
});

export default router;
