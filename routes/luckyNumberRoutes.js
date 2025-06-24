const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  startGame,
  rollDice,
  finalizeGame,
  getGameStatus
} = require('../controllers/luckyController');

router.post('/start', authenticateToken, startGame);
router.post('/roll', authenticateToken, rollDice);
router.post('/finalize', authenticateToken, finalizeGame);
router.get('/status/:gameId', authenticateToken, getGameStatus);

module.exports = router;