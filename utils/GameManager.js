const { checkWalletBalance, updateWalletBalance } = require("../routes/wallet");

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
      
      console.log(`🎮 New SixKingGame created: ${gameId} with stake ₹${stake}`);
    }
  
    addPlayer(player) {
      console.log(`🔍 Adding player to game ${this.gameId}. Current players: ${this.players.length}`);
      
      if (this.players.length >= 2) {
        console.error(`❌ Game ${this.gameId} is full! Players: ${this.players.map(p => p.name).join(', ')}`);
        throw new Error('Game is full');
      }
  
      // Check if player is already in the game
      const existingPlayer = this.players.find(p => p.id === player.id);
      if (existingPlayer) {
        console.warn(`⚠️ Player ${player.name} (${player.id}) is already in game ${this.gameId}`);
        return; // Don't add duplicate player
      }
      
      this.players.push(player);
      this.scores[player.id] = 0;
  
      console.log(`✅ Player added to game ${this.gameId}: ${player.name} (${this.players.length}/2)`);
      console.log(`📊 Current players: ${this.players.map(p => `${p.name}(${p.id})`).join(', ')}`);
    }
  
    startGame() {
      console.log(`🚀 Attempting to start game ${this.gameId}. State: ${this.state}, Players: ${this.players.length}`);
      
      if (this.players.length < 2) {
        throw new Error('Need 2 players to start the game');
      }
  
      if (this.state === 'playing') {
        console.log(`⚠️ Game ${this.gameId} is already in playing state`);
        return; // Don't throw error, just return
      }
  
      if (this.state === 'finished') {
        throw new Error('Game has already finished');
      }
      
      this.state = 'playing';
      this.currentTurn = this.players[Math.floor(Math.random() * 2)].id;
      
      console.log(`✅ Game ${this.gameId} started! First player: ${this.currentTurn}`);
      
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
  
    //   const diceValue = Math.floor(Math.random() * 6) + 1;
      const diceValue = 6;
      this.rollCount++;
  
      console.log(`🎲 ${playerId} rolled ${diceValue} in game ${this.gameId}`);
  
      if (diceValue === 6) {
        this.scores[playerId]++;
        console.log(`👑 ${playerId} now has ${this.scores[playerId]} crowns`);
      }
  
      // Broadcast dice roll to all players
      this.broadcast('dice_rolled', {
        playerId,
        diceValue,
        newSixCount: this.scores[playerId],
        rollCount: this.rollCount,
        timestamp: Date.now() // Add timestamp
      });
  
      if (this.scores[playerId] >= 3) {
        this.endGame(playerId);
        return { diceValue, gameEnded: true, winner: playerId };
      }
  
      // Switch turns
      this.currentTurn = this.getOtherPlayer(playerId).id;
  
      this.broadcast('turn_changed', {
        nextPlayer: this.currentTurn
      });
  
      return { diceValue, gameEnded: false };
    }
  
    endGame(winnerId) {
      this.state = 'finished';
      
      console.log(`🏆 Game ${this.gameId} ended! Winner: ${winnerId}`);
      
      this.broadcast('game_ended', {
        winner: winnerId,
        finalScores: this.scores,
        rollCount: this.rollCount,
        stake: this.stake
      });
  
      // TODO: Integrate with your existing wallet system
      this.updatePlayerWallets(winnerId);
    }
  
    async updatePlayerWallets(winnerId) {
        try {
          const winner = this.players.find(p => p.id === winnerId);
          const loser = this.getOtherPlayer(winnerId);
          
          console.log(`💰 Wallet update needed:`);
          console.log(`  Winner ${winner.name} (${winnerId}): +₹${this.stake * 2}`);
          
          // ✅ Properly await async functions
          const currentBalance = await checkWalletBalance(winnerId);
          const newBalance = currentBalance + (this.stake * 2);
          
          await updateWalletBalance(winnerId, newBalance);
          
        } catch (error) {
          console.error('Error updating player wallets:', error);
        }
      }
  
    getOtherPlayer(playerId) {
      return this.players.find(p => p.id !== playerId);
    }
  
    removePlayer(playerId) {
      const playerIndex = this.players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        const removedPlayer = this.players[playerIndex];
        this.players.splice(playerIndex, 1);
        
        console.log(`👋 Player ${removedPlayer.name} removed from game ${this.gameId}`);
        
        if (this.state === 'playing' && this.players.length === 1) {
          const remainingPlayer = this.players[0];
          console.log(`🏆 ${remainingPlayer.name} wins by default (opponent left)`);
          
          this.broadcast('player_left', {
            leftPlayerId: playerId,
            winner: remainingPlayer.id,
            message: 'Opponent left the game'
          });
          
          this.endGame(remainingPlayer.id);
        } else if (this.state === 'waiting') {
          this.broadcast('player_left', {
            leftPlayerId: playerId,
            message: 'Player left the lobby'
          });
        }   
      }
    }
  
    broadcast(type, data) {
      const message = JSON.stringify({ type, data });
      console.log(`📢 Broadcasting to game ${this.gameId}: ${type}`);
      
      this.players.forEach(player => {
        if (player.ws && player.ws.readyState === 1) { // WebSocket.OPEN
          player.ws.send(message);
        }
      });
    }
  }
  
  function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  
  module.exports = { 
    SixKingGame, 
    generateGameCode 
  };