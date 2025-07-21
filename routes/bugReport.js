import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import BugReport from '../models/BugReport.js';
import User from '../models/User.js';
import config from '../config/index.js';

const router = express.Router();

// Ensure folder exists
const screenshotDir = 'uploads/screenshots';
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, screenshotDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'screenshot-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage });

router.get('/bug-report', (req, res) => {
  if (!req.session.userId) return res.redirect('/');

  res.render('bug-report', {
      referer: req.headers.referer
  });

});

router.post('/bug-report', requireVerifiedEmail, upload.single('screenshot'), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/');

    const report = new BugReport({
      userId: user._id,
      email: user.email,
      description: req.body.description,
      pageUrl: req.body.pageUrl,
      screenshot: req.file ? req.file.filename : undefined
    });

    await report.save();
    res.render('bugs/thank-you', { message: 'Your report has been submitted successfully.' });
  } catch (err) {
    console.error('Bug report error:', err);
    res.status(500).render('error', { error: 'Failed to submit bug report' });
  }
});

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

// 📥 View submitted bug reports
router.get('/bugs', requireVerifiedEmail, requireAdminDomain, async (req, res) => {
  try {
    const bugs = await BugReport.find().sort({ createdAt: -1 }).lean();
    res.render('bugs/view', { bugs });
  } catch (err) {
    console.error('Failed to load bug reports:', err);
    res.status(500).render('error', { error: 'Failed to load bug reports.' });
  }
});

router.post('/bugs/:id/delete', requireVerifiedEmail, requireAdminDomain, async (req, res) => {
  try {
    const { id } = req.params;
    await BugReport.findByIdAndDelete(id);
    res.redirect('/bugs');
  } catch (err) {
    console.error('Error deleting bug report:', err);
    res.status(500).render('error', { error: 'Unable to delete bug report' });
  }
});

export default router;