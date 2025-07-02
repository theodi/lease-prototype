// routes/public.js
import express from 'express';
import { sendVerificationCode, verifyManualCode } from '../controllers/Auth.js';

const router = express.Router();

// Home page
router.get('/', (req, res) => {
  res.render('index');
});

// Email verification
router.post('/verify-email', sendVerificationCode);
router.post('/verify-code', verifyManualCode);

export default router;
