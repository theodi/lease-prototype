require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const User = require('./models/User');
const config = require('./config');

const app = express();

// Connect to MongoDB
mongoose.connect(config.mongodbUri)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Session configuration
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

// Middleware to attach user to request
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

// Routes
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { error: 'Something went wrong!' });
});

// Schedule cleanup tasks
setInterval(async () => {
    try {
        await User.cleanupUnverified();
        await User.anonymizeInactive();
    } catch (error) {
        console.error('Error in cleanup tasks:', error);
    }
}, 15 * 60 * 1000); // Run every 15 minutes

app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
    if (config.isDevelopment) {
        console.log('Development mode is active');
        console.log(`Default verification code: ${config.devVerificationCode}`);
    }
}); 