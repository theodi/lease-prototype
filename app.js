import 'dotenv/config.js';
import express from 'express';
import session from 'express-session';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';
import mongoose from 'mongoose';
import MongoStore from 'connect-mongo';
import User from './models/User.js';
import config from './config/index.js';

import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import leaseRoutes from './routes/lease.js';
import dashboardRoutes from './routes/dashboard.js';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();

// Needed because __dirname is not defined in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connect to MongoDB
mongoose.connect(config.mongodbUri)
  .then(() => {
    console.log('✅ Connected to MongoDB');
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Session config
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: config.mongodbUri,
    ttl: 24 * 60 * 60 // 1 day
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Attach user to request if logged in
app.use(async (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (user) {
        req.user = user;
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    }
  }
  next();
});

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', leaseRoutes);
app.use('/', dashboardRoutes);

// ─────────────────────────────────────────────
// Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { error: 'Something went wrong!' });
});

// ─────────────────────────────────────────────
// Cleanup Tasks
// ─────────────────────────────────────────────
setInterval(async () => {
  try {
    await User.cleanupUnverified();
    await User.anonymizeInactive();
  } catch (error) {
    console.error('Error in cleanup tasks:', error);
  }
}, 15 * 60 * 1000); // Every 15 minutes

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`🚀 Server is running on port ${config.port}`);
  if (config.isDevelopment) {
    console.log('🧪 Development mode is active');
    console.log(`🔐 Default verification code: ${config.devVerificationCode}`);
  }
  if (config.isTesting) {
    console.log('🧪 Testing mode is active');
    console.log(`🔐 Only users from the following domains are permitted: ${config.allowedDomains.join(', ')}`);
  }
});