const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const {
  startGame,
  rollDice,
  finalizeGame,
  getGameStatus,
  leaveGame,
  validateBoard,
  getActiveGames
} = require('../controllers/snakeController');

// Routes for Snake & Ladder Game
router.post('/start', authenticateToken, startGame);
router.post('/roll', authenticateToken, rollDice);
router.post('/finalize', authenticateToken, finalizeGame);
router.get('/status/:gameId', authenticateToken, getGameStatus);
router.post('/leave_game', authenticateToken, leaveGame);

// Additional utility routes
router.get('/validate-board', authenticateToken, validateBoard);
router.get('/active-games', authenticateToken, getActiveGames);

module.exports = router;