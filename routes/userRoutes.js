const express = require('express');
const router = express.Router();
const {  verifyOtp, signup, login, getUserData } = require('../controllers/userController');

router.post('/signin', signup);
router.post('/login',login)
router.post('/verify-otp', verifyOtp);
router.get('/me',getUserData)

module.exports = router;