// routes/auth.js
import express from 'express';
import User from '../models/User.js';
import Lease from '../models/Lease.js';
import LeaseUpdateLog from '../models/LeaseUpdateLog.js';

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
    const bookmarkedLeases = await user.getBookmarkedLeases();

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
/*
// Manual postcode search logging
router.post('/app/lookup', requireVerifiedEmail, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    await user.checkSearchCount();
    const remainingSearches = await user.getRemainingSearches();

    res.render('app', {
      email: user.email,
      remainingSearches,
      message: 'Search recorded successfully'
    });
  } catch (error) {
    if (error.message === 'Daily search limit reached') {
      return res.status(400).render('app', {
        email: req.user.email,
        remainingSearches: 0,
        error: 'You have reached your daily search limit. Please try again tomorrow.'
      });
    }

    console.error('Error processing search:', error);
    res.status(500).render('error', { error: 'Failed to process search' });
  }
});
*/
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

export default router;
