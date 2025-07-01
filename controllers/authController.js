const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const config = require('../config');

// Create email transporter
const transporter = nodemailer.createTransport({
    service: config.email.service,
    auth: {
        user: config.email.user,
        pass: config.email.pass
    }
});

exports.sendVerificationCode = async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).render('index', { error: 'Email is required' });
        }

        // Generate verification code based on environment
        const code = config.isDevelopment 
            ? config.devVerificationCode 
            : Math.floor(100000 + Math.random() * 900000).toString();
        
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Find or create user
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ email });
        }

        // Update verification code
        user.verificationCode = { code, expiresAt };
        user.isVerified = false;
        await user.save();

        // Only send email in production
        if (!config.isDevelopment) {
            const mailOptions = {
                from: config.email.user,
                to: email,
                subject: 'Your Verification Code',
                html: `
                    <h1>Email Verification</h1>
                    <p>Your verification code is: <strong>${code}</strong></p>
                    <p>This code will expire in 15 minutes.</p>
                    <p>Enter this code on the verification page to continue.</p>
                `
            };

            await transporter.sendMail(mailOptions);
        }
        
        // In development, show the code on the page
        res.render('verification-sent', { 
            email,
            code: config.isDevelopment ? code : undefined,
            isDevelopment: config.isDevelopment
        });
    } catch (error) {
        console.error('Error sending verification code:', error);
        res.status(500).render('error', { error: 'Failed to send verification code' });
    }
};

exports.verifyManualCode = async (req, res) => {
    try {
        const { email, code } = req.body;
        
        const user = await User.findOne({ 
            email,
            'verificationCode.code': code,
            'verificationCode.expiresAt': { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).render('verification-sent', { 
                email,
                error: 'Invalid or expired verification code',
                isDevelopment: config.isDevelopment
            });
        }

        // Update user verification status and add login
        user.isVerified = true;
        user.verificationCode = undefined;
        await user.addLogin(req.ip);

        // Set session
        req.session.userId = user._id;
        
        res.render('verified', { email: user.email });
    } catch (error) {
        console.error('Error verifying code:', error);
        res.status(500).render('error', { error: 'Failed to verify code' });
    }
}; 