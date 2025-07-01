const { checkWalletBalance, updateWalletBalance } = require('./routes/walletRoutes');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// In-memory storage
const games = new Map();
const players = new Map();
const waitingQueue = new Map();
const adminCache = new Map(); // playerId → isAdmin

// Modified SixKingGame class with database integration
class SixKingGame {
  constructor(gameId, hostPlayer, stake) {
    this.gameId = gameId;
    this.stake = stake;
    this.players = [hostPlayer];
    this.state = 'waiting'; // waiting, playing, finished
    this.currentTurn = null;
    this.scores = {};
    this.rollCount = 0;
    this.createdAt = new Date();
    this.scores[hostPlayer.id] = 0;
    
    // Store initial game session in database
    this.createGameSession(hostPlayer);
    
    console.log(`🎮 New game created: ${gameId} with stake ₹${stake}`);
  }

  // Create game session in database
  async createGameSession(hostPlayer) {
    try {
      // Create unique gameId for each player session
      const playerGameId = `${this.gameId}_${hostPlayer.id}`;
      
      await prisma.gameSession.create({
        data: {
          gameId: playerGameId, // Unique per player
          userId: hostPlayer.id,
          gameType: 'six_king',
          stake: this.stake,
          winAmount: this.stake * 2,
          status: 'active'
        }
      });
      
      console.log(`💾 Game session created in DB: ${playerGameId}`);
    } catch (error) {
      console.error('Error creating game session:', error);
    }
  }

  // Update game session when second player joins
  async updateGameSessionWithSecondPlayer(secondPlayer) {
    try {
      // Create unique gameId for second player
      const playerGameId = `${this.gameId}_${secondPlayer.id}`;
      
      await prisma.gameSession.create({
        data: {
          gameId: playerGameId, // Unique per player
          userId: secondPlayer.id,
          gameType: 'six_king',
          stake: this.stake,
          winAmount: this.stake * 2,
          status: 'active'
        }
      });
      
      console.log(`💾 Second player session created in DB: ${playerGameId}`);
    } catch (error) {
      console.error('Error creating second player session:', error);
    }
  }

  addPlayer(player) {
    if (this.players.length >= 2) {
      throw new Error('Game is full');
    }

    const existingPlayer = this.players.find(p => p.id === player.id);
    if (existingPlayer) {
      console.warn(`⚠️ Player ${player.name} already in game`);
      return;
    }
    
    this.players.push(player);
    this.scores[player.id] = 0;
    console.log(`✅ Player added: ${player.name} (${this.players.length}/2)`);

    // Update database with second player
    if (this.players.length === 2) {
      this.updateGameSessionWithSecondPlayer(player);
      setTimeout(() => this.startGame(), 100);
    }
  }

  startGame() {
    if (this.players.length < 2) {
      throw new Error('Need 2 players to start');
    }

    if (this.state !== 'waiting') {
      return; // Already started
    }
    
    this.state = 'playing';
    this.currentTurn = this.players[Math.floor(Math.random() * 2)].id;
    
    console.log(`🚀 Game ${this.gameId} started! First player: ${this.currentTurn}`);
    
    this.broadcast('game_started', {
      gameId: this.gameId,
      firstPlayer: this.currentTurn,
      players: this.players.map(p => ({ id: p.id, name: p.name })),
      stake: this.stake
    });
  }

  rollDice(playerId, adminDiceValue = null) {
    if (this.state !== 'playing') {
      throw new Error('Game is not in playing state');
    }

    if (this.currentTurn !== playerId) {
      throw new Error('Not your turn');
    }

    let diceValue;
    
    // Check if admin dice value is provided and user is admin
    if (adminDiceValue !== null && GameManager.isAdmin(playerId)) {
      diceValue = adminDiceValue;
      console.log(`🔑 Admin ${playerId} forced dice value to ${diceValue}`);
    } else {
      console.log("Are you doing normal");
      // Normal random dice roll
      diceValue = Math.floor(Math.random() * 6) + 1;
      console.log(`🎲 ${playerId} rolled ${diceValue} (normal roll)`);
    }

    this.rollCount++;

    if (diceValue === 6) {
      this.scores[playerId]++;
    }

    this.broadcast('dice_rolled', {
      playerId,
      diceValue,
      newSixCount: this.scores[playerId],
      rollCount: this.rollCount,
      timestamp: Date.now(),
      isAdminRoll: adminDiceValue !== null && GameManager.isAdmin(playerId)
    });

    // Check win condition
    if (this.scores[playerId] >= 3) {
      this.endGame(playerId);
      return { diceValue, gameEnded: true, winner: playerId };
    }

    // Switch turns
    this.currentTurn = this.getOtherPlayer(playerId).id;
    this.broadcast('turn_changed', { nextPlayer: this.currentTurn });

    return { diceValue, gameEnded: false };
  }

  async endGame(winnerId) {
    this.state = 'finished';
    
    console.log(`🏆 Game ${this.gameId} ended! Winner: ${winnerId}`);
    
    this.broadcast('game_ended', {
      winner: winnerId,
      finalScores: this.scores,
      rollCount: this.rollCount,
      stake: this.stake
    });

    // Update database and winner's wallet
    try {
      const currentBalance = await checkWalletBalance(winnerId);
      const newBalance = currentBalance + (this.stake * 2);
      
      // Find the loser
      const loserId = this.players.find(p => p.id !== winnerId).id;
      
      // Update database in transaction
      await prisma.$transaction(async (prisma) => {
        // Update winner's wallet
        await updateWalletBalance(winnerId, newBalance);
        
        // Update winner's game session
        await prisma.gameSession.updateMany({
          where: { 
            gameId: `${this.gameId}_${winnerId}`, 
            userId: winnerId 
          },
          data: {
            status: 'completed',
            result: 'win',
            rollHistory: this.rollCount.toString(),
            completedAt: new Date()
          }
        });
        
        // Update loser's game session
        await prisma.gameSession.updateMany({
          where: { 
            gameId: `${this.gameId}_${loserId}`, 
            userId: loserId 
          },
          data: {
            status: 'completed',
            result: 'loss',
            rollHistory: this.rollCount.toString(),
            completedAt: new Date()
          }
        });
        
        // Create transaction records
        await prisma.transaction.create({
          data: {
            userId: winnerId,
            amount: this.stake * 2,
            type: 'game_win',
            gameId: `${this.gameId}_${winnerId}`, // Use unique gameId
            description: `Six King Game: Won - ${this.scores[winnerId]} sixes, ${this.rollCount} total rolls`
          }
        });
        
        await prisma.transaction.create({
          data: {
            userId: loserId,
            amount: -this.stake,
            type: 'game_loss',
            gameId: `${this.gameId}_${loserId}`, // Use unique gameId
            description: `Six King Game: Lost - ${this.scores[loserId]} sixes, ${this.rollCount} total rolls`
          }
        });
      });
      
      console.log(`💰 Winner ${winnerId} received ₹${this.stake * 2}`);
      console.log(`💾 Game results saved to database`);
    } catch (error) {
      console.error('Error updating winner wallet and database:', error);
    }

    // Cleanup after 5 seconds
    setTimeout(() => {
      games.delete(this.gameId);
      this.players.forEach(p => players.delete(p.id));
      console.log(`🧹 Cleaned up game ${this.gameId}`);
    }, 5000);
  }

  // FIXED: Handle player leaving game with proper win/leave logic
  async handlePlayerLeave(playerId) {
    try {
      // Find the remaining player (if any) BEFORE removing the leaving player
      const remainingPlayer = this.players.find(p => p.id !== playerId);
      
      console.log(`🔍 Processing leave for player ${playerId}, remaining player: ${remainingPlayer?.id}`);
      
      if (this.state === 'playing' && remainingPlayer) {
        // Game was in progress - remaining player wins, leaving player loses by leaving
        const currentBalance = await checkWalletBalance(remainingPlayer.id);
        const newBalance = currentBalance + (this.stake * 2);
        
        await prisma.$transaction(async (prisma) => {
          // Update winner's wallet (remaining player)
          await updateWalletBalance(remainingPlayer.id, newBalance);
          
          // Update WINNER's game session (remaining player)
          await prisma.gameSession.updateMany({
            where: { 
              gameId: `${this.gameId}_${remainingPlayer.id}`, 
              userId: remainingPlayer.id 
            },
            data: {
              status: 'completed',
              result: 'win', // WINNER gets 'win'
              rollHistory: this.rollCount.toString(),
              completedAt: new Date()
            }
          });
          
          console.log(`✅ Updated winner ${remainingPlayer.id}: status=completed, result=win`);
          
          // Update LEAVER's game session
          await prisma.gameSession.updateMany({
            where: { 
              gameId: `${this.gameId}_${playerId}`, 
              userId: playerId 
            },
            data: {
              status: 'completed', // Changed from 'left' to 'completed'
              result: 'left', // LEAVER gets 'left' as result
              rollHistory: this.rollCount.toString(),
              completedAt: new Date()
            }
          });
          
          console.log(`✅ Updated leaver ${playerId}: status=completed, result=left`);
          
          // Create transaction records
          await prisma.transaction.create({
            data: {
              userId: remainingPlayer.id,
              amount: this.stake * 2,
              type: 'game_win',
              gameId: `${this.gameId}_${remainingPlayer.id}`,
              description: `Six King Game: Won by opponent leaving - ${this.rollCount} total rolls`
            }
          });
          
          await prisma.transaction.create({
            data: {
              userId: playerId,
              amount: -this.stake,
              type: 'game_left', // Different transaction type for leaving
              gameId: `${this.gameId}_${playerId}`,
              description: `Six King Game: Left game - ${this.rollCount} total rolls`
            }
          });
        });
        
        console.log(`💰 Remaining player ${remainingPlayer.id} received ₹${this.stake * 2} due to opponent leaving`);
        console.log(`🏃 Player ${playerId} left and lost stake`);
      } else if (this.state === 'waiting' || this.state === 'lobby') {
        // Game was in lobby/waiting - just mark as left with no winner
        await prisma.gameSession.updateMany({
          where: { 
            gameId: `${this.gameId}_${playerId}`, 
            userId: playerId 
          },
          data: {
            status: 'left', // Status is 'left' for lobby leaves
            result: 'left', // Result is also 'left'
            completedAt: new Date()
          }
        });
        
        console.log(`✅ Updated lobby leaver ${playerId}: status=left, result=left`);
        
        // Return stake to player who left during lobby (optional - depends on your business logic)
        await prisma.transaction.create({
          data: {
            userId: playerId,
            amount: 0, // You can decide whether to return stake or not
            type: 'game_lobby_left',
            gameId: `${this.gameId}_${playerId}`,
            description: `Six King Game: Left lobby before game started`
          }
        });
      }
      
      console.log(`💾 Player leave processed in database`);
    } catch (error) {
      console.error('Error handling player leave in database:', error);
    }
  }

  removePlayer(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    const removedPlayer = this.players[playerIndex];
    
    console.log(`👋 Player ${removedPlayer.name} left game ${this.gameId}`);
    
    // Handle database updates for player leaving BEFORE removing from array
    this.handlePlayerLeave(playerId);
    
    // Now remove the player from the array
    this.players.splice(playerIndex, 1);
    
    if (this.state === 'playing' && this.players.length === 1) {
      const remainingPlayer = this.players[0];
      
      // Mark game as finished to prevent further moves
      this.state = 'finished';
      
      this.broadcast('player_left', {
        leftPlayerId: playerId,
        winner: remainingPlayer.id,
        message: 'Opponent left the game'
      });
      
      // Broadcast game ended message
      this.broadcast('game_ended', {
        winner: remainingPlayer.id,
        finalScores: this.scores,
        rollCount: this.rollCount,
        stake: this.stake,
        reason: 'opponent_left'
      });
      
    } else {
      this.broadcast('player_left', {
        leftPlayerId: playerId,
        message: 'Player left the lobby'
      });
    }
    
    // Clean up game if no players left
    if (this.players.length === 0) {
      setTimeout(() => {
        games.delete(this.gameId);
        console.log(`🧹 Cleaned up empty game ${this.gameId}`);
      }, 1000);
    }
  }

  getOtherPlayer(playerId) {
    return this.players.find(p => p.id !== playerId);
  }

  broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    this.players.forEach(player => {
      if (player.ws && player.ws.readyState === 1) {
        player.ws.send(message);
      }
    });
  }
}

// Game Manager Functions
const GameManager = {
  // Initialize admin cache on server start
  async initializeAdminCache() {
    await this.refreshAdminCache();
  },

  // Create a new game
  async createGame(playerData) {
    const gameId = this.generateGameCode();
    const game = new SixKingGame(gameId, playerData, playerData.stake);
    
    games.set(gameId, game);
    players.set(playerData.id, { player: playerData, gameId });
    
    return { gameId, stake: playerData.stake };
  },

  // Call this once when server starts or when admin status changes
  async refreshAdminCache() {
    try {
      // Option 1: If you have a role field in your user table
      const admins = await prisma.user.findMany({
        where: { role: 'admin' },
        select: { id: true }
      });
      
      adminCache.clear();
      admins.forEach(admin => adminCache.set(admin.id, true));
      console.log(`🔑 Loaded ${admins.length} admins into cache`);
      
    } catch (error) {
      console.log('⚠️ Role field not found, using hardcoded admin list');
      // Option 2: Hardcoded admin list (temporary solution)
      const hardcodedAdmins = [
        '24b0ae7d-e702-42c6-965e-df6b08a1b3e2', // Add your actual user IDs here
        // Add more admin user IDs as needed
      ];
      
      adminCache.clear();
      hardcodedAdmins.forEach(adminId => adminCache.set(adminId, true));
      console.log(`🔑 Loaded ${hardcodedAdmins.length} hardcoded admins into cache`);
    }
  },

  // Initialize admin cache on server start
  async initializeAdminCache() {
    await this.refreshAdminCache();
  },

  isAdmin(playerId) {
    const isAdminUser = adminCache.has(playerId);
    console.log(`🔍 Checking admin status for ${playerId}: ${isAdminUser}`);
    return isAdminUser;
  },

  // admin check (for debugging)
  async checkAdminStatus(playerId) {
    try {
      return adminCache.has(playerId);;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return null;
    }
  },

  // Join existing game
  joinGame(gameId, playerData) {
    const game = games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.players.length >= 2) {
      throw new Error('Game is full');
    }

    if (game.stake !== playerData.stake) {
      throw new Error('Stake amount does not match');
    }

    game.addPlayer(playerData);
    players.set(playerData.id, { player: playerData, gameId });

    return {
      gameId,
      stake: game.stake,
      playersCount: game.players.length,
      gameReady: game.players.length === 2
    };
  },

  // Find match in queue
  async findMatch(playerData) {
    const stake = playerData.stake;
    
    if (!waitingQueue.has(stake)) {
      waitingQueue.set(stake, []);
    }

    const queue = waitingQueue.get(stake);
    
    if (queue.length > 0) {
      const waitingPlayer = queue.shift();
      
      console.log(`🎯 Match found: ${waitingPlayer.name} vs ${playerData.name}`);
      
      const gameId = this.generateGameCode();
      const game = new SixKingGame(gameId, waitingPlayer, stake);
      game.addPlayer(playerData);
      games.set(gameId, game);
      
      players.set(waitingPlayer.id, { player: waitingPlayer, gameId });
      players.set(playerData.id, { player: playerData, gameId });

      return {
        matched: true,
        gameId,
        waitingPlayer,
        newPlayer: playerData,
        stake
      };
    } else {
      queue.push(playerData);
      return {
        matched: false,
        message: 'Waiting for opponent...'
      };
    }
  },

  // Roll dice
  rollDice(gameId, playerId, adminDiceValue = null) {
    const game = games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }
    return game.rollDice(playerId,adminDiceValue);
  },

  // Leave game
  leaveGame(gameId, playerId) {
    const game = games.get(gameId);
    if (game) {
      game.removePlayer(playerId);
      if (game.players.length === 0) {
        games.delete(gameId);
      }
    }
    
    players.delete(playerId);
    
    // Remove from queue
    waitingQueue.forEach((queue, stake) => {
      const index = queue.findIndex(p => p.id === playerId);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    });
  },

  // Get game
  getGame(gameId) {
    return games.get(gameId);
  },

  // Get player by WebSocket
  getPlayerByWebSocket(ws) {
    for (const [playerId, playerData] of players) {
      if (playerData.player.ws === ws) {
        return { playerId, gameId: playerData.gameId };
      }
    }
    return null;
  },

  // Get active games
  getActiveGames() {
    return Array.from(games.values()).map(game => ({
      gameId: game.gameId,
      stake: game.stake,
      players: game.players.length,
      state: game.state,
      createdAt: game.createdAt
    }));
  },

  // Generate game code
  generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  },

  // Update player connection
  updatePlayerConnection(gameId, playerId, newWs) {
    const game = games.get(gameId);
    if (game) {
      const player = game.players.find(p => p.id === playerId);
      if (player) {
        player.ws = newWs;
        console.log(`🔄 Updated WebSocket for player ${playerId}`);
        return true;
      }
    }
    return false;
  }
};

module.exports = GameManager;