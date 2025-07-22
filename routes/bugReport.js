import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
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

// Rate limiting: configurable via config.bugReportRateLimitPerDay
const bugReportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: config.bugReportRateLimitPerDay || 5, // Default 5 per day
  message: 'You have reached the daily bug report submission limit.',
  keyGenerator: (req) => req.session.userId || req.ip
});

// Multer: file type and size limits
const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Serve uploaded screenshots with strict headers
router.get('/uploads/screenshots/:filename', requireVerifiedEmail, (req, res) => {
  const file = path.join(screenshotDir, req.params.filename);
  // Only allow files with allowed extensions
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
    return res.status(403).send('Forbidden');
  }
  res.setHeader('Content-Type', `image/${ext.replace('.', '')}`);
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(path.resolve(file));
});

router.get('/bug-report', requireVerifiedEmail, bugReportLimiter, (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  res.render('bug-report', {
      referer: req.headers.referer
  });
});

const requireVerifiedEmail = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');
  next();
};

router.post('/bug-report', requireVerifiedEmail, bugReportLimiter, upload.single('screenshot'), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect('/');

    // Sanitize and validate input
    let description = req.body.description || '';
    description = validator.escape(description.trim());
    if (description.length < 10 || description.length > 2000) {
      return res.status(400).render('error', { error: 'Description must be between 10 and 2000 characters.' });
    }
    let pageUrl = req.body.pageUrl || '';
    pageUrl = validator.trim(pageUrl);
    if (pageUrl && (!validator.isURL(pageUrl, { require_protocol: false, require_host: false }) || pageUrl.length > 300)) {
      return res.status(400).render('error', { error: 'Invalid page URL.' });
    }

    let screenshotFilename;
    if (req.file) {
      // Double-check file type
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).render('error', { error: 'Invalid file type.' });
      }
      screenshotFilename = req.file.filename;
    }

    const report = new BugReport({
      userId: user._id,
      email: user.email,
      description,
      pageUrl,
      screenshot: screenshotFilename
    });

    await report.save();
    res.render('bugs/thank-you', { message: 'Your report has been submitted successfully.' });
  } catch (err) {
    console.error('Bug report error:', err);
    res.status(500).render('error', { error: 'Failed to submit bug report' });
  }
});

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