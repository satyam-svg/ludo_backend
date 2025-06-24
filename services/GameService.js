const { checkWalletBalance } = require('../routes/walletRoutes');
const { SixKingGame, generateGameCode } = require('../utils/GameManager');

const games = new Map();
const players = new Map();
const waitingQueue = new Map();

class GameService {
  static createGame(playerData) {
    const gameId = generateGameCode();
    const game = new SixKingGame(gameId, playerData, playerData.stake);
    games.set(gameId, game);
    players.set(playerData.id, { player: playerData, gameId });
    
    console.log(`📊 Game created: ${gameId}`);
    return { gameId, stake: playerData.stake };
  }

  static async getUserWallet(playerId) {
    try {
      return await checkWalletBalance(playerId);
    } catch (error) {
      console.error('Error getting user wallet:', error);
      return 0; // or throw error
    }
  }

  static joinGame(gameId, playerData) {
    const game = games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.players.length >= 2) {
      throw new Error('Game is full');
    }

    if (game.stake !== playerData.stake) {
      throw new Error(`Stake mismatch`);
    }

    const existingPlayer = game.players.find(p => p.id === playerData.id);
    if (existingPlayer) {
      console.warn(`⚠️ Player already in game`);
      return {
        gameId,
        stake: game.stake,
        playersCount: game.players.length,
        gameReady: game.players.length === 2
      };
    }

    game.addPlayer(playerData);
    players.set(playerData.id, { player: playerData, gameId });

    console.log(`📊 Player joined: ${playerData.name} (${game.players.length}/2)`);

    const isGameReady = game.players.length === 2;

    if (isGameReady) {
      console.log(`🚀 Starting game ${gameId} with 2 players`);
      setTimeout(() => {
        if (game.state === 'waiting') {
          game.startGame();
        }
      }, 100);
    }

    return {
      gameId,
      stake: game.stake,
      playersCount: game.players.length,
      gameReady: isGameReady
    };
  }

  static findMatch(playerData) {
    const stake = playerData.stake;
    
    if (!waitingQueue.has(stake)) {
      waitingQueue.set(stake, []);
    }

    const queue = waitingQueue.get(stake);
    
    if (queue.length > 0) {
      const waitingPlayer = queue.shift();
      
      console.log(`🎯 MATCH: ${waitingPlayer.name} vs ${playerData.name}`);
      
      const gameId = generateGameCode();
      const game = new SixKingGame(gameId, waitingPlayer, stake);
      game.addPlayer(playerData);
      games.set(gameId, game);
      
      players.set(waitingPlayer.id, { player: waitingPlayer, gameId });
      players.set(playerData.id, { player: playerData, gameId });

      // Start immediately
      setTimeout(() => {
        console.log(`🚀 Auto-starting game ${gameId}`);
        game.startGame();
      }, 200);

      return {
        matched: true,
        gameId,
        waitingPlayer,
        newPlayer: playerData,
        stake
      };
    } else {
      queue.push(playerData);
      console.log(`⏳ Added to queue: ${playerData.name}`);
      
      return {
        matched: false,
        message: `Looking for opponent...`
      };
    }
  }

  static rollDice(gameId, playerId) {
    const game = games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }
  
    const result = game.rollDice(playerId);
    
    if (result.gameEnded) {
      console.log(`🏆 Game ${gameId} ended! Winner: ${result.winner}`);
      
      // Clean up immediately to prevent "match found" messages
      setTimeout(() => {
        console.log(`🧹 Cleaning up finished game ${gameId}`);
        games.delete(gameId);
        game.players.forEach(p => {
          players.delete(p.id);
          console.log(`🧹 Removed player ${p.id} from active players`);
        });
      }, 100); // Short delay to ensure all messages are sent
    }
  
    return result;
  }

  static leaveGame(gameId, playerId) {
    const game = games.get(gameId);
    if (game) {
      game.removePlayer(playerId);
      if (game.players.length === 0) {
        games.delete(gameId);
      }
    }
    players.delete(playerId);
    
    waitingQueue.forEach((queue, stake) => {
      const index = queue.findIndex(p => p.id === playerId);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    });
  }

  static getGame(gameId) {
    return games.get(gameId);
  }

  static getPlayerByWebSocket(ws) {
    for (const [playerId, playerData] of players) {
      if (playerData.player.ws === ws) {
        return { playerId, gameId: playerData.gameId };
      }
    }
    return null;
  }
}

module.exports = GameService;