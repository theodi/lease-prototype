const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const User = require('../models/User');
const leaseController = require('../controllers/leaseController');

// Middleware to check if email is verified
const requireVerifiedEmail = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    next();
};

// Home page
router.get('/', (req, res) => {
    res.render('index');
});

// Email verification routes
router.post('/verify-email', authController.sendVerificationCode);
router.post('/verify-code', authController.verifyManualCode);

// Main application route (protected)
router.get('/app', requireVerifiedEmail, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const remainingSearches = user.getRemainingSearches();
        const bookmarkedLeases = await user.getBookmarkedLeases();
        res.render('app', {
            email: user.email,
            remainingSearches,
            bookmarkedLeases
        });
    } catch (error) {
        console.error('Error loading app page:', error);
        res.status(500).render('error', { error: 'Failed to load application' });
    }
});

// Search route
router.post('/app/lookup', requireVerifiedEmail, async (req, res) => {
    try {
        const { postcode, saveHistory } = req.body;
        const user = await User.findById(req.session.userId);

        // Add the search
        await user.addSearch(postcode, saveHistory === 'on');

        // Get updated user data
        const remainingSearches = user.getRemainingSearches();

        // For now, just show a success message
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

// Add this route for AJAX fuzzy address lookup
router.get('/app/lease-lookup', requireVerifiedEmail, leaseController.lookup);

// Add this route for viewing a lease record by ID
router.get('/app/lease/:id', requireVerifiedEmail, leaseController.show);

// Add this route for bookmarking a lease
router.post('/app/lease/:id/bookmark', requireVerifiedEmail, leaseController.bookmark);

// Add this route for unbookmarking a lease
router.post('/app/lease/:id/unbookmark', requireVerifiedEmail, leaseController.unbookmark);

module.exports = router; 