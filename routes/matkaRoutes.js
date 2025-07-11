const express = require('express');
const router = express.Router();
const {
  getSlots,
  placeBet,
  getUserSessions
} = require('../controllers/matkaController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get all available slots with user's bets
router.get('/slots', authenticateToken, getSlots);

// Place a bet in a slot
router.post('/bet', authenticateToken, placeBet);

// Get user's game sessions
router.get('/sessions', authenticateToken, getUserSessions);

module.exports = router;