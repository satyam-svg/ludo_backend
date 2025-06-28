const express = require('express');
const router = express.Router();
const {
  getSlots,
  placeBet,
  getUserSessions,
  getGameSession
} = require('../controllers/matkaController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get all available slots with user's bets
router.get('/slots', authenticateToken, getSlots);

// Place a bet in a slot
router.post('/place-bet', authenticateToken, placeBet);

// Get user's game sessions
router.get('/sessions', authenticateToken, getUserSessions);

// Get specific game session
router.get('/session/:gameId', authenticateToken, getGameSession);

module.exports = router;