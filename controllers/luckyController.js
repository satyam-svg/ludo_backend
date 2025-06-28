const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

// In-memory game sessions
const gameSessions = new Map();

const createBiasedDice = (luckyNumber) => {
  const baseDice = [1, 2, 3, 4, 5, 6];
  const biasedDice = [...baseDice];
  
  // if (luckyNumber === 1) {
  //   biasedDice.push(2, 2);
  // } else if (luckyNumber === 6) {
  //   biasedDice.push(5, 5);
  // } else {
  //   biasedDice.push(luckyNumber - 1, luckyNumber + 1);
  // }
  
  return biasedDice;
};

const secureRandom = (array) => {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return array[randomValue % array.length];
};

exports.startGame = async (req, res) => {
  try {
    const { stake, luckyNumber } = req.body;
    const userId = req.user.id;

    if (!stake || !luckyNumber || luckyNumber < 1 || luckyNumber > 6) {
      return res.status(400).json({ error: 'Invalid stake or lucky number' });
    }

    const stakeAmount = parseFloat(stake);
    if (stakeAmount <= 0) return res.status(400).json({ error: 'Invalid stake amount' });

    const user = await prisma.user.findUnique({ where: { id: userId }});
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.wallet < stakeAmount) return res.status(400).json({ error: 'Insufficient balance' });

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
};

exports.rollDice = async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const gameSession = gameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });
    if (gameSession.gameState !== 'active') return res.status(400).json({ error: 'Game is not active' });
    if (gameSession.rollsLeft <= 0) return res.status(400).json({ error: 'No rolls left' });

    const diceValue = secureRandom(gameSession.biasedDice);
    gameSession.rollHistory.push(diceValue);
    gameSession.rollsLeft--;

    let gameResult = null;
    let won = false;

    if (diceValue === gameSession.luckyNumber) {
      won = true;
      gameSession.gameState = 'completed';
      gameResult = { won: true, winAmount: gameSession.winAmount, finalRoll: diceValue };
    } else if (gameSession.rollsLeft <= 0) {
      gameSession.gameState = 'completed';
      gameResult = { won: false, lostAmount: gameSession.stake, finalRoll: diceValue };
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
};

exports.finalizeGame = async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const gameSession = gameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });
    if (gameSession.gameState !== 'completed') return res.status(400).json({ error: 'Game not completed' });
    if (gameSession.finalized) return res.status(400).json({ error: 'Game already finalized' });

    const won = gameSession.rollHistory.includes(gameSession.luckyNumber);
    let transactionAmount = 0;
    let newBalance = 0;

    const result = await prisma.$transaction(async (prisma) => {
      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (!user) throw new Error('User not found');

      if (won) {
        transactionAmount = gameSession.winAmount;
        newBalance = user.wallet + gameSession.winAmount;
      } else {
        transactionAmount = -gameSession.stake;
        newBalance = user.wallet - gameSession.stake;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { wallet: newBalance }
      });

      await prisma.transaction.create({
        data: {
          userId,
          amount: transactionAmount,
          type: won ? 'game_win' : 'game_loss',
          gameId,
          description: `Lucky Number Game: ${won ? 'Won' : 'Lost'} - Number: ${gameSession.luckyNumber}, Rolls: ${gameSession.rollHistory.join(', ')}`
        }
      });

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
};

exports.getGameStatus = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;

    const gameSession = gameSessions.get(gameId);
    if (!gameSession) return res.status(404).json({ error: 'Game session not found' });
    if (gameSession.userId !== userId) return res.status(403).json({ error: 'Unauthorized access' });

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
};

exports.leaveGame = async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

    if (!gameId) return res.status(400).json({ error: 'Game ID required' });

    const gameSession = gameSessions.get(gameId);
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
          description: `Lucky Number Game: Left - Number: ${gameSession.luckyNumber}, Stake: ₹${gameSession.stake}`
        }
      });

      // Update game session in database
      await prisma.gameSession.update({
        where: { gameId },
        data: {
          status: 'left',
          result: 'left',
          completedAt: new Date()
        }
      });

      return { newBalance };
    });

    // Update in-memory session
    gameSession.gameState = 'left';
    gameSession.finalized = true;
    gameSession.finalBalance = result.newBalance;
    gameSessions.set(gameId, gameSession);

    res.json({
      success: true,
      message: 'Game left successfully',
      newBalance: result.newBalance,
      deductedAmount: gameSession.stake,
      gameId
    });

  } catch (error) {
    console.error('Error in leaving game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
