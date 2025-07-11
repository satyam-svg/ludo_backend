const express = require('express');
const router = express.Router();
const {  verifyOtp, signup, login, getUserData, gamesHistory, processReferralBonus } = require('../controllers/userController');

router.post('/signup', signup);
router.post('/login',login)
router.post('/verify-otp', verifyOtp);
router.get('/me',getUserData);
router.get('/process-referral',processReferralBonus);
router.get('/games-history',gamesHistory);

module.exports = router;