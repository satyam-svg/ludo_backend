const express = require('express');
const router = express.Router();
const {
  getSlots,
  placeBet,
  getUserBets,
  getSlotDetails
} = require('../controllers/matkaContoller');
const { authenticateToken } = require('../middleware/authMiddleware');


router.get('/slots', authenticateToken, getSlots);


router.post('/bet', authenticateToken, placeBet);

// Get user's bets (with optional date filter)
router.get('/bets', authenticateToken, getUserBets);

// Get details of a specific slot including user's bet (if any)
router.get('/slots/:slotId', authenticateToken, getSlotDetails);

module.exports = router;