import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import config from '../config/index.js'; // make sure config is ESM-compatible

// Create email transporter
function createTransporter() {
  const { host, port, user, pass } = config.email;

  const baseOptions = {
    host,
    port,
    secure: port === 465, // only use true for SSL (usually port 465)
    tls: {
      rejectUnauthorized: false // optional, for relaxed certs
    }
  };

  if (user && pass) {
    baseOptions.auth = {
      user,
      pass
    };
  }

  return nodemailer.createTransport(baseOptions);
}

export const transporter = createTransporter();

export async function sendVerificationCode(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).render('index', { error: 'Email is required' });
    }

    // Check domain restriction in testing mode
    if (config.isTesting) {
      const allowedDomains = config.allowedDomains || []; // e.g. ['theodi.org']
      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (!emailDomain || !allowedDomains.includes(emailDomain)) {
        return res.status(400).render('index', {
          error: `Only email addresses from allowed domains can be used in testing mode.`
        });
      }
    }

    // Generate verification code
    const code = config.isDevelopment
      ? config.devVerificationCode
      : Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ email });
    }

    user.verificationCode = { code, expiresAt };
    user.isVerified = false;
    await user.save();

    if (!config.isDevelopment) {
      const mailOptions = {
        from: `"Check your lease length" <${config.email.from}>`,
        to: email,
        subject: 'Your verification code',
        html: `
          <h1>Email verification</h1>
          <p>Your verification code is: <strong>${code}</strong></p>
          <p>This code will expire in 15 minutes.</p>
          <p>Enter this code on the verification page to continue.</p>
        `
      };

      await transporter.sendMail(mailOptions);
    }

    res.render('verification-sent', {
      email,
      code: config.isDevelopment ? code : undefined,
      isDevelopment: config.isDevelopment
    });
  } catch (error) {
    console.error('Error sending verification code:', error);
    res.status(500).render('error', { error: 'Failed to send verification code' });
  }
}

export async function verifyManualCode(req, res) {
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

    user.isVerified = true;
    user.verificationCode = undefined;
    await user.addLogin(req.ip);
    req.session.userId = user._id;

    res.redirect('/app');
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).render('error', { error: 'Failed to verify code' });
  }
}