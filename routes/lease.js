// routes/lease.js
import express from 'express';
import {
  show,
  lookup,
  bookmark,
  unbookmark,
  deriveTerm,
  getLoadStatus
} from '../controllers/Lease.js';
import config from '../config/index.js';

const router = express.Router();

const requireVerifiedEmail = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');
  next();
};

// Lease routes
router.get('/app/lease-lookup', requireVerifiedEmail, lookup);
router.get('/app/lease/:id', requireVerifiedEmail, show);
router.post('/app/lease/:id/bookmark', requireVerifiedEmail, bookmark);
router.post('/app/lease/:id/unbookmark', requireVerifiedEmail, unbookmark);
router.post('/app/lease/derive-term', requireVerifiedEmail, deriveTerm);

// Load status endpoint (no auth required for monitoring)
router.get('/app/search-load', (req, res) => {
  res.json(getLoadStatus());
});

// Client config endpoint (no auth required)
router.get('/app/client-config', (req, res) => {
  res.json({
    search: {
      maxConcurrentSearches: config.search.maxConcurrentSearches,
      maxTimeMS: config.search.maxTimeMS,
      overloadThreshold: config.search.overloadThreshold
    }
  });
});

export default router;