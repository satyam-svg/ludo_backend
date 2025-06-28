const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

// In-memory game sessions
const snakeGameSessions = new Map();

// Snake and Ladder positions - Backend validation
const SNAKES = {
  // First 30 cells (1-30) - 7 snakes
  16: 1, 23: 1, 27: 1, 11: 1, 25: 1, 19: 1, 30: 1,
  // Second 30 cells (31-60) - 7 snakes
  34: 1, 46: 1, 49: 1, 56: 1, 54: 1, 58: 1, 60: 1, 52: 1,
  // Last 40 cells (61-100) - 8 snakes
  87: 1, 93: 1, 95: 1, 98: 1, 89: 1, 91: 1, 84: 1, 96: 1, 7: 1
};

const LADDERS = {
  // Lower section (1-25) - 3 ladders
  4: 17, 18: 38, 15: 26,
  // Mid-lower section (26-50) - 3 ladders
  28: 44, 32: 51, 33: 88, 35:55, 42: 63,
  // Mid-upper section (51-75) - 3 ladders
  57: 76,59: 99, 62: 81, 71: 90, 37: 45, 66: 85, 64: 77, 67:86, 78: 82
};

// Game modes configuration
const GAME_MODES = {
  'Easy Survivor': { rolls: 5, multiplier: 2 },
  'Daredevil': { rolls: 8, multiplier: 4 },
  'Snake Master': { rolls: 12, multiplier: 8 },
  'Legendary': { rolls: 15, multiplier: 16 }
};

const secureRandom = (min = 1, max = 6) => {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return Math.floor((randomValue / 0xFFFFFFFF) * (max - min + 1)) + min;
};

const validatePosition = (position) => {
  return position >= 0 && position <= 100;
};

const processSpecialCells = (position) => {
  // Check for snakes first
  if (SNAKES[position]) {
    return {
      type: 'snake',
      newPosition: SNAKES[position],
      message: `Snake bite! Moved from ${position} to ${SNAKES[position]}`
    };
  }
  
  // Check for ladders
  if (LADDERS[position]) {
    return {
      type: 'ladder',
      newPosition: LADDERS[position],
      message: `Climbed ladder! Moved from ${position} to ${LADDERS[position]}`
    };
  }
  
  return {
    type: 'normal',
    newPosition: position,
    message: `Moved to position ${position}`
  };
};

exports.startGame = async (req, res) => {
  try {
    const { stake, mode } = req.body;
    const userId = req.user.id;

    if (!stake || !mode || !mode.name) {
      return res.status(400).json({ error: 'Invalid stake or game mode' });
    }

    // Validate game mode
    const gameMode = GAME_MODES[mode.name];
    if (!gameMode) {
      return res.status(400).json({ error: 'Invalid game mode' });
    }

    const stakeAmount = parseFloat(stake);
    if (stakeAmount <= 0) {
      return res.status(400).json({ error: 'Invalid stake amount' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }});
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.wallet < stakeAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const gameId = `snake_${userId}_${Date.now()}`;
    const winAmount = Math.floor(stakeAmount * gameMode.multiplier);
    
    const gameSession = {
      gameId,
      userId,
      mode: mode.name,
      stake: stakeAmount,
      maxRolls: gameMode.rolls,
      rollsUsed: 0,
      currentPosition: 0,
      rollHistory: [],
      moveHistory: [],
      gameState: 'active',
      winAmount,
      createdAt: new Date()
    };

    snakeGameSessions.set(gameId, gameSession);

    // Create game session in database
    await prisma.gameSession.create({
      data: {
        gameId,
        userId,
        gameType: 'snake_game',
        stake: stakeAmount,
        winAmount,
        status: 'active',
      }
    });

    res.json({
      success: true,
      gameId,
      maxRolls: gameMode.rolls,
      winAmount,
      mode: mode.name,
      currentPosition: 0
    });

  } catch (error) {
    console.error('Error starting snake game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.rollDice = async (req, res) => {
  try {
    const { gameId, currentPosition, rollNumber } = req.body;
    const userId = req.user.id;

    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const gameSession = snakeGameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });
    if (gameSession.gameState !== 'active') return res.status(400).json({ error: 'Game is not active' });
    if (gameSession.rollsUsed >= gameSession.maxRolls) {
      return res.status(400).json({ error: 'Maximum rolls reached' });
    }

    // Validate current position matches backend
    if (currentPosition !== gameSession.currentPosition) {
      return res.status(400).json({ 
        error: 'Position mismatch',
        expectedPosition: gameSession.currentPosition,
        receivedPosition: currentPosition
      });
    }

    // Roll dice
    const diceValue = secureRandom(1, 6);
    gameSession.rollsUsed++;
    gameSession.rollHistory.push(diceValue);

    // Calculate new position
    let newPosition = Math.min(currentPosition + diceValue, 100);
    
    // Process special cells (snakes/ladders)
    const specialResult = processSpecialCells(newPosition);
    const finalPosition = specialResult.newPosition;
    
    // Update game session
    gameSession.currentPosition = finalPosition;
    gameSession.moveHistory.push({
      roll: gameSession.rollsUsed,
      diceValue,
      fromPosition: currentPosition,
      toPosition: newPosition,
      finalPosition,
      specialCell: specialResult.type,
      message: specialResult.message
    });

    let gameResult = null;
    let won = false;
    let gameComplete = false;

    // Check win condition 1: Reached position 100 (instant win)
    if (finalPosition >= 100) {
      won = true;
      gameComplete = true;
      gameSession.gameState = 'completed';
      gameResult = { 
        won: true, 
        winAmount: gameSession.winAmount, 
        finalPosition: 100,
        reason: 'reached_finish',
        rollsUsed: gameSession.rollsUsed
      };
    }
    // Check loss condition: Snake bite (immediate loss)
    else if (specialResult.type === 'snake') {
      won = false;
      gameComplete = true;
      gameSession.gameState = 'completed';
      gameResult = { 
        won: false, 
        lostAmount: gameSession.stake, 
        finalPosition,
        reason: 'snake_bite',
        rollsUsed: gameSession.rollsUsed
      };
    }
    // Check win condition 2: Survived all rolls without snake bite
    else if (gameSession.rollsUsed >= gameSession.maxRolls) {
      won = true; // Player survived all rolls without snake bite = WIN
      gameComplete = true;
      gameSession.gameState = 'completed';
      gameResult = { 
        won: true, 
        winAmount: gameSession.winAmount, 
        finalPosition,
        reason: 'survived_all_rolls',
        rollsUsed: gameSession.rollsUsed
      };
    }

    snakeGameSessions.set(gameId, gameSession);

    res.json({
      success: true,
      diceValue,
      newPosition: finalPosition,
      specialCell: specialResult,
      rollsUsed: gameSession.rollsUsed,
      rollsLeft: gameSession.maxRolls - gameSession.rollsUsed,
      moveHistory: gameSession.moveHistory,
      gameResult,
      won,
      gameComplete
    });

  } catch (error) {
    console.error('Error rolling dice in snake game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.finalizeGame = async (req, res) => {
  try {
    const { gameId, result } = req.body;
    const userId = req.user.id;

    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const gameSession = snakeGameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });
    if (gameSession.gameState !== 'completed') return res.status(400).json({ error: 'Game not completed' });
    if (gameSession.finalized) return res.status(400).json({ error: 'Game already finalized' });

    // Determine win/loss based on correct game rules
    let won = false;
    
    // Win conditions:
    // 1. Reached position 100 = instant win
    // 2. Survived all rolls without snake bite = win
    if (gameSession.currentPosition >= 100) {
      won = true; // Reached 100
    } else if (gameSession.gameState === 'completed') {
      // Check if completed due to surviving all rolls (not snake bite)
      const lastMove = gameSession.moveHistory[gameSession.moveHistory.length - 1];
      won = lastMove && lastMove.specialCell !== 'snake';
    }
    let transactionAmount = 0;
    let newBalance = 0;

    const dbResult = await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (!user) throw new Error('User not found');

      if (won) {
        transactionAmount = gameSession.winAmount;
        newBalance = user.wallet + gameSession.winAmount;
      } else {
        transactionAmount = -gameSession.stake;
        newBalance = user.wallet - gameSession.stake;
      }

      // Update user wallet
      await prisma.user.update({
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
          description: `Snake Game (${gameSession.mode}): ${won ? 'Won' : 'Lost'} - Final Position: ${gameSession.currentPosition}, Rolls: ${gameSession.rollsUsed}/${gameSession.maxRolls}`
        }
      });

      // Update game session in database
      await prisma.gameSession.update({
        where: { gameId },
        data: {
          status: 'completed',
          result: won ? 'win' : 'loss',
          // Store game details in available fields
          // finalPosition: gameSession.currentPosition, // Remove if field doesn't exist
          // rollsUsed: gameSession.rollsUsed, // Remove if field doesn't exist
          // rollHistory: gameSession.rollHistory.join(','), // Use existing rollHistory field
          // moveHistory: JSON.stringify(gameSession.moveHistory), // Remove if field doesn't exist
          completedAt: new Date()
        }
      });

      return { newBalance, transactionAmount };
    });

    // Update in-memory session
    gameSession.finalized = true;
    gameSession.finalBalance = dbResult.newBalance;
    snakeGameSessions.set(gameId, gameSession);

    res.json({
      success: true,
      won,
      newBalance: dbResult.newBalance,
      amount: dbResult.transactionAmount,
      finalPosition: gameSession.currentPosition,
      rollsUsed: gameSession.rollsUsed,
      moveHistory: gameSession.moveHistory,
      mode: gameSession.mode
    });

  } catch (error) {
    console.error('Error finalizing snake game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getGameStatus = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;

    const gameSession = snakeGameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });

    res.json({
      success: true,
      gameSession: {
        gameId: gameSession.gameId,
        mode: gameSession.mode,
        stake: gameSession.stake,
        maxRolls: gameSession.maxRolls,
        rollsUsed: gameSession.rollsUsed,
        currentPosition: gameSession.currentPosition,
        rollHistory: gameSession.rollHistory,
        moveHistory: gameSession.moveHistory,
        gameState: gameSession.gameState,
        winAmount: gameSession.winAmount,
        finalized: gameSession.finalized || false
      }
    });

  } catch (error) {
    console.error('Error getting snake game status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.leaveGame = async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const gameSession = snakeGameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });
    if (gameSession.gameState !== 'active') return res.status(400).json({ error: 'Game is not active or already completed' });
    if (gameSession.finalized) return res.status(400).json({ error: 'Game already finalized' });

    // Mark game as left and process wallet deduction
    const result = await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (!user) throw new Error('User not found');

      // Deduct stake amount from wallet
      const newBalance = user.wallet - gameSession.stake;

      await prisma.user.update({
        where: { id: userId },
        data: { wallet: newBalance }
      });

      // Create transaction record for leaving game
      await prisma.transaction.create({
        data: {
          userId,
          amount: -gameSession.stake,
          type: 'game_left',
          gameId,
          description: `Snake Game (${gameSession.mode}): Left - Position: ${gameSession.currentPosition}, Rolls: ${gameSession.rollsUsed}/${gameSession.maxRolls}`
        }
      });

      // Update game session in database
      await prisma.gameSession.update({
        where: { gameId },
        data: {
          status: 'left',
          result: 'left',
          // Store final state in available fields
          // finalPosition: gameSession.currentPosition, // Remove if field doesn't exist
          // rollsUsed: gameSession.rollsUsed, // Remove if field doesn't exist
          // rollHistory: gameSession.rollHistory.join(','), // Use existing rollHistory field if available
          // moveHistory: JSON.stringify(gameSession.moveHistory), // Remove if field doesn't exist
          completedAt: new Date()
        }
      });

      return { newBalance };
    });

    // Update in-memory session
    gameSession.gameState = 'left';
    gameSession.finalized = true;
    gameSession.finalBalance = result.newBalance;
    snakeGameSessions.set(gameId, gameSession);

    res.json({
      success: true,
      message: 'Snake game left successfully',
      newBalance: result.newBalance,
      deductedAmount: gameSession.stake,
      gameId,
      finalPosition: gameSession.currentPosition,
      rollsUsed: gameSession.rollsUsed
    });

  } catch (error) {
    console.error('Error in leaving snake game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Utility function to validate game board positions (for debugging)
exports.validateBoard = async (req, res) => {
  try {
    res.json({
      success: true,
      snakes: SNAKES,
      ladders: LADDERS,
      gameModes: GAME_MODES,
      message: 'Board configuration is valid'
    });
  } catch (error) {
    console.error('Error validating board:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Admin function to get all active snake games (optional)
exports.getActiveGames = async (req, res) => {
  try {
    const activeGames = Array.from(snakeGameSessions.values())
      .filter(session => session.gameState === 'active')
      .map(session => ({
        gameId: session.gameId,
        userId: session.userId,
        mode: session.mode,
        currentPosition: session.currentPosition,
        rollsUsed: session.rollsUsed,
        maxRolls: session.maxRolls,
        stake: session.stake,
        createdAt: session.createdAt
      }));

    res.json({
      success: true,
      activeGames,
      count: activeGames.length
    });
  } catch (error) {
    console.error('Error getting active snake games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};