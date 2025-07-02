// routes/lease.js
import express from 'express';
import {
  show,
  lookup,
  bookmark,
  unbookmark,
  deriveTerm
} from '../controllers/Lease.js';

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

export default router;