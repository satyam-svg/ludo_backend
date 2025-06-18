// routes/luckyNumber.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// TEMPORARY: Bypass authentication middleware
const authenticateToken = (req, res, next) => {
  // TODO: Uncomment this when JWT is implemented
  /*
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
  */
  
  // TEMPORARY: Use a hardcoded user for testing
  // Replace this with a real user ID from your database
  req.user = { 
    id: '24b0ae7d-e702-42c6-965e-df6b08a1b3e2' // Replace with actual user ID from your database
  };
  next();
};

// In-memory game sessions
const gameSessions = new Map();

// Helper function to create biased dice
const createBiasedDice = (luckyNumber) => {
  const baseDice = [1, 2, 3, 4, 5, 6];
  const biasedDice = [...baseDice];
  
  if (luckyNumber === 1) {
    biasedDice.push(2, 2);
  } else if (luckyNumber === 6) {
    biasedDice.push(5, 5);
  } else {
    biasedDice.push(luckyNumber - 1, luckyNumber + 1);
  }
  
  return biasedDice;
};

// Secure random number generator
const secureRandom = (array) => {
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  const index = randomValue % array.length;
  return array[index];
};

// Start new game
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const { stake, luckyNumber } = req.body;
    const userId = req.user.id; // This will use the hardcoded test user ID

    // Validate input
    if (!stake || !luckyNumber || luckyNumber < 1 || luckyNumber > 6) {
      return res.status(400).json({ error: 'Invalid stake or lucky number' });
    }

    const stakeAmount = parseFloat(stake);
    if (stakeAmount <= 0) {
      return res.status(400).json({ error: 'Invalid stake amount' });
    }

    // Get user and check balance
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.wallet < stakeAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create game session
    const gameId = `lucky_${userId}_${Date.now()}`;
    const winAmount = Math.floor(stakeAmount * 2.5);
    
    const gameSession = {
      gameId,
      userId,
      luckyNumber: parseInt(luckyNumber),
      stake: stakeAmount,
      rollsLeft: 2,
      rollHistory: [],
      biasedDice: createBiasedDice(parseInt(luckyNumber)),
      gameState: 'active',
      winAmount,
      createdAt: new Date()
    };

    gameSessions.set(gameId, gameSession);

    // Create game record in database
    await prisma.gameSession.create({
      data: {
        gameId,
        userId,
        gameType: 'lucky_number',
        stake: stakeAmount,
        luckyNumber: parseInt(luckyNumber),
        winAmount,
        status: 'active'
      }
    });

    res.json({
      success: true,
      gameId,
      rollsLeft: 2,
      winAmount,
      luckyNumber: parseInt(luckyNumber)
    });

  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Roll dice
router.post('/roll', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }

    // Get game session
    const gameSession = gameSessions.get(gameId);
    if (!gameSession) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    // Verify game belongs to user
    if (gameSession.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized access to game' });
    }

    // Check game state
    if (gameSession.gameState !== 'active') {
      return res.status(400).json({ error: 'Game is not active' });
    }

    // Check rolls left
    if (gameSession.rollsLeft <= 0) {
      return res.status(400).json({ error: 'No rolls left' });
    }

    // Generate dice value
    const diceValue = secureRandom(gameSession.biasedDice);
    
    // Update game session
    gameSession.rollHistory.push(diceValue);
    gameSession.rollsLeft--;

    let gameResult = null;
    let won = false;

    // Check if player won
    if (diceValue === gameSession.luckyNumber) {
      won = true;
      gameSession.gameState = 'completed';
      gameResult = {
        won: true,
        winAmount: gameSession.winAmount,
        finalRoll: diceValue
      };
    } else if (gameSession.rollsLeft <= 0) {
      // Game over
      gameSession.gameState = 'completed';
      gameResult = {
        won: false,
        lostAmount: gameSession.stake,
        finalRoll: diceValue
      };
    }

    gameSessions.set(gameId, gameSession);

    res.json({
      success: true,
      diceValue,
      rollsLeft: gameSession.rollsLeft,
      rollHistory: gameSession.rollHistory,
      gameResult,
      won
    });

  } catch (error) {
    console.error('Error rolling dice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Finalize game
router.post('/finalize', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }

    // Get game session
    const gameSession = gameSessions.get(gameId);
    if (!gameSession) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    // Verify game belongs to user
    if (gameSession.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized access to game' });
    }

    // Check if game is completed
    if (gameSession.gameState !== 'completed') {
      return res.status(400).json({ error: 'Game is not completed yet' });
    }

    // Check if already finalized
    if (gameSession.finalized) {
      return res.status(400).json({ error: 'Game already finalized' });
    }

    const won = gameSession.rollHistory.includes(gameSession.luckyNumber);
    let transactionAmount = 0;
    let newBalance = 0;

    // Use Prisma transaction for atomic operations
    const result = await prisma.$transaction(async (prisma) => {
      // Get current user balance
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (won) {
        // Player won - add winnings
        transactionAmount = gameSession.winAmount;
        newBalance = user.wallet + gameSession.winAmount;
      } else {
        // Player lost - deduct stake
        transactionAmount = -gameSession.stake;
        newBalance = user.wallet - gameSession.stake;
      }

      // Update user wallet
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { wallet: newBalance }
      });

      // Create transaction record
      await prisma.transaction.create({
        data: {
          userId,
          amount: transactionAmount,
          type: won ? 'game_win' : 'game_loss',
          gameId,
          description: `Lucky Number Game: ${won ? 'Won' : 'Lost'} - Number: ${gameSession.luckyNumber}, Rolls: ${gameSession.rollHistory.join(', ')}`
        }
      });

      // Update game session in database
      await prisma.gameSession.update({
        where: { gameId },
        data: {
          status: 'completed',
          result: won ? 'win' : 'loss',
          rollHistory: gameSession.rollHistory.join(','),
          completedAt: new Date()
        }
      });

      return { newBalance, transactionAmount };
    });

    // Mark session as finalized
    gameSession.finalized = true;
    gameSession.finalBalance = result.newBalance;
    gameSessions.set(gameId, gameSession);

    res.json({
      success: true,
      won,
      newBalance: result.newBalance,
      amount: result.transactionAmount,
      rollHistory: gameSession.rollHistory,
      luckyNumber: gameSession.luckyNumber
    });

  } catch (error) {
    console.error('Error finalizing game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game status
router.get('/status/:gameId', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;

    const gameSession = gameSessions.get(gameId);
    if (!gameSession) {
      return res.status(404).json({ error: 'Game session not found' });
    }

    if (gameSession.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized access to game' });
    }

    res.json({
      success: true,
      gameSession: {
        gameId: gameSession.gameId,
        luckyNumber: gameSession.luckyNumber,
        stake: gameSession.stake,
        rollsLeft: gameSession.rollsLeft,
        rollHistory: gameSession.rollHistory,
        gameState: gameSession.gameState,
        winAmount: gameSession.winAmount,
        finalized: gameSession.finalized || false
      }
    });

  } catch (error) {
    console.error('Error getting game status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;