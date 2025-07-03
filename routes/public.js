// routes/public.js
import express from 'express';
import { sendVerificationCode, verifyManualCode } from '../controllers/Auth.js';

const router = express.Router();

// Home page with redirect for verified users
router.get('/', (req, res) => {
  if (req.session?.userId) {
    return res.redirect('/app');
  }
  res.render('index');
});

// Email verification
router.post('/verify-email', sendVerificationCode);
router.post('/verify-code', verifyManualCode);

export default router;