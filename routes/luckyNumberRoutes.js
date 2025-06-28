const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  startGame,
  rollDice,
  finalizeGame,
  getGameStatus,
  leaveGame
} = require('../controllers/luckyController');

//routes for lucky number
router.post('/start', authenticateToken, startGame);
router.post('/roll', authenticateToken, rollDice);
router.post('/finalize', authenticateToken, finalizeGame);
router.get('/status/:gameId', authenticateToken, getGameStatus);
router.post('/leave_game', authenticateToken, leaveGame);

module.exports = router;
