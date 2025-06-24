const GameService = require('../services/GameService');
const {updateWalletBalance, checkWalletBalance} = require('../routes/walletRoutes')

function handleMessage(ws, type, data) {
  try {
    console.log(`📨 Handling message: ${type}`, data);
    
    switch (type) {
      case 'roll_dice':
        handleRollDice(ws, data);
        break;  
      case 'create_game':
        handleCreateGame(ws, data);
        break;
      case 'join_game':
        handleJoinGame(ws, data);
        break;
      case 'start_game':
        handleStartGame(ws, data);
        break;
      case 'leave_game':
        handleLeaveGame(ws, data);
        break;
      case 'join_queue':
        handleJoinQueue(ws, data);
        break;
      case 'update_connection':
        handleUpdateConnection(ws,data);
        break;
      case 'ping':
        handlePing(ws, data);
        break;
      case 'pong':  // ADD THIS
        console.log('🏓 Received pong from client');
        break;
      default:
        sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendError(ws, 'INTERNAL_ERROR', 'An error occurred processing your request');
  }
}

async function handleCreateGame(ws, data) {
    const { playerId, playerName, stake, gameType } = data;
    
    console.log(`🎮 Creating game for player ${playerName} with stake ₹${stake}`);
    
    if (gameType !== 'six_king') {
      sendError(ws, 'INVALID_GAME_TYPE', 'Only six_king game type is supported');
      return;
    }
  
    try {
      // ✅ Properly await async function
      const userWallet = await GameService.getUserWallet(playerId);
      
      if (userWallet < parseInt(stake)) {
        sendError(ws, 'INSUFFICIENT_BALANCE', 'Please deposit to continue');
        return;
      }
  
      const playerData = {
        id: playerId,
        name: playerName,
        ws,
        stake: parseInt(stake)
      };
  
      const result = GameService.createGame(playerData);
      
      console.log(`✅ Game created with ID: ${result.gameId}`);
      
      updateWalletBalance(playerId,userWallet - parseInt(stake));

      ws.send(JSON.stringify({
        type: 'game_created',
        data: result
      }));
    } catch (error) {
      console.error('Create game error:', error);
      sendError(ws, 'CREATE_FAILED', error.message);
    }
  }

  async function handleJoinGame(ws, data) {
    const { gameId, playerId, playerName, stake } = data;
    
    console.log(`🔗 Player ${playerName} trying to join game ${gameId}`);
    
    try {
      // ✅ Properly await async function
      const userWallet = await GameService.getUserWallet(playerId);
      
      if (userWallet < parseInt(stake)) {
        sendError(ws, 'INSUFFICIENT_BALANCE', 'Please deposit to continue');
        return;
      }
  
      const playerData = {
        id: playerId,
        name: playerName,
        ws,
        stake: parseInt(stake)
      };
  
      const result = GameService.joinGame(gameId, playerData);
      
      console.log(`✅ Player ${playerName} joined game ${gameId}`);

      updateWalletBalance(playerId,userWallet - parseInt(stake));
      
      ws.send(JSON.stringify({
        type: 'game_joined',
        data: result
      }));
    } catch (error) {
      console.error('Join game error:', error);
      sendError(ws, 'JOIN_FAILED', error.message);
    }
  }

function handleStartGame(ws, data) {
  const { gameId, playerId } = data;
  
  console.log(`🚀 Player ${playerId} attempting to start game ${gameId}`);
  
  try {
    GameService.startGame(gameId, playerId);
    console.log(`✅ Game ${gameId} started successfully`);
    
    // Send acknowledgment to the player who started
    ws.send(JSON.stringify({
      type: 'start_acknowledged',
      data: { 
        message: 'Game start request processed',
        gameId: gameId
      }
    }));
  } catch (error) {
    console.error('Start game error:', error);
    // Don't send error if game is already started - this is expected behavior
    if (error.message.includes('already started') || error.message.includes('playing state')) {
      console.log(`ℹ️ Game ${gameId} start request ignored - already started`);
      ws.send(JSON.stringify({
        type: 'start_acknowledged',
        data: { 
          message: 'Game already started',
          gameId: gameId
        }
      }));
    } else {
      sendError(ws, 'START_FAILED', error.message);
    }
  }
}

async function handleJoinQueue(ws, data) {
    const { playerId, playerName, stake } = data;
    
    console.log(`🔍 Player ${playerName} joining queue`);
    
    const playerData = {
      id: playerId,
      name: playerName,
      ws,
      stake: parseInt(stake)
    };
  
    try {
      const result = GameService.findMatch(playerData);
      
      if (result.matched) {
        console.log(`🎯 Match found!`);
        console.log(result);
      
        try {
          // ✅ Extract IDs correctly
          const newPlayerId = result.newPlayer.id;        // 'cedc4052-53b9-4a29-a838-5e15b68dfbcc'
          const waitingPlayerId = result.waitingPlayer.id; // '09dc8e78-6c1b-48af-ab52-dc282ca14f3a'
          const stakeAmount = result.stake;                // 100
      
          console.log(`💰 Processing stake deduction:`);
          console.log(`  New Player ID: ${newPlayerId}`);
          console.log(`  Waiting Player ID: ${waitingPlayerId}`);
          console.log(`  Stake Amount: ${stakeAmount}`);
      
          // ✅ Get current wallet balances
          const newPlayerBalance = await checkWalletBalance(newPlayerId);
          const waitingPlayerBalance = await checkWalletBalance(waitingPlayerId);
      
          console.log(`💳 Current balances:`);
          console.log(`  New Player: ₹${newPlayerBalance}`);
          console.log(`  Waiting Player: ₹${waitingPlayerBalance}`);
      
          // ✅ Check sufficient balances
          if (newPlayerBalance < stakeAmount) {
            sendError(ws, 'INSUFFICIENT_BALANCE', 'Insufficient balance for stake');
            return;
          }
      
          if (waitingPlayerBalance < stakeAmount) {
            sendError(result.waitingPlayer.ws, 'INSUFFICIENT_BALANCE', 'Waiting player has insufficient balance');
            return;
          }
      
          // ✅ Calculate new balances
          const newPlayerNewBalance = newPlayerBalance - stakeAmount;
          const waitingPlayerNewBalance = waitingPlayerBalance - stakeAmount;
      
          // ✅ Update wallets with correct parameters
          await updateWalletBalance(newPlayerId, newPlayerNewBalance);
          await updateWalletBalance(waitingPlayerId, waitingPlayerNewBalance);
      
          console.log(`✅ Wallet updates completed:`);
          console.log(`  New Player: ₹${newPlayerBalance} → ₹${newPlayerNewBalance}`);
          console.log(`  Waiting Player: ₹${waitingPlayerBalance} → ₹${waitingPlayerNewBalance}`);
      
          // Send match notifications
          result.waitingPlayer.ws.send(JSON.stringify({
            type: 'game_matched',
            data: { 
              gameId: result.gameId, 
              opponent: { id: newPlayerId, name: result.newPlayer.name },
              stake: result.stake
            }
          }));
      
          ws.send(JSON.stringify({
            type: 'game_matched',
            data: { 
              gameId: result.gameId, 
              opponent: { id: waitingPlayerId, name: result.waitingPlayer.name },
              stake: result.stake
            }
          }));
      
        } catch (error) {
          console.error('Error processing match:', error);
          sendError(ws, 'MATCH_FAILED', 'Failed to process stake deduction');
          return;
        }
      } else {
        ws.send(JSON.stringify({
          type: 'queued',
          data: { message: result.message }
        }));
      }
    } catch (error) {
      console.error('Match error:', error);
      sendError(ws, 'MATCH_FAILED', error.message);
    }
  }

  function handleRollDice(ws, data) {
    const { gameId, playerId } = data;
    
    console.log(`🎲 Player ${playerId} rolling dice in game ${gameId}`);
    
    try {
      const result = GameService.rollDice(gameId, playerId);
      console.log(`🎲 Dice result: ${result.diceValue}, Game ended: ${result.gameEnded}`);
      
      // CRITICAL: Force immediate message delivery for dice results
      const game = GameService.getGame(gameId);
      if (game) {
        // Send dice_rolled message with high priority
        const diceMessage = {
          type: 'dice_rolled',
          data: {
            playerId,
            diceValue: result.diceValue,
            newSixCount: game.scores[playerId],
            rollCount: game.rollCount,
            timestamp: Date.now()
          }
        };
        
        // Send immediately to all players
        game.players.forEach(player => {
          if (player.ws && player.ws.readyState === 1) {
            try {
              player.ws.send(JSON.stringify(diceMessage));
              console.log(`🚀 Immediate dice result sent to ${player.id}`);
            } catch (error) {
              console.error(`❌ Failed immediate send to ${player.id}:`, error);
            }
          }
        });
      }
      
    } catch (error) {
      console.error('Roll dice error:', error);
      sendError(ws, 'ROLL_FAILED', error.message);
    }
  }

function handleLeaveGame(ws, data) {
  const { gameId, playerId, opponentId, stake } = data;
  console.log(`👋 Player ${playerId} leaving game ${gameId}`);
  GameService.leaveGame(gameId, playerId);
}

function handlePing(ws, data) {
  ws.send(JSON.stringify({ 
    type: 'pong', 
    data: { timestamp: new Date().toISOString() } 
  }));
}

function handleDisconnection(ws) {
  console.log('🔌 Player disconnected');
  const playerInfo = GameService.getPlayerByWebSocket(ws);
  if (playerInfo) {
    console.log(`👋 Cleaning up game ${playerInfo.gameId} for player ${playerInfo.playerId}`);
    GameService.leaveGame(playerInfo.gameId, playerInfo.playerId);
  }
}

function sendError(ws, code, message) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify({
      type: 'error',
      data: { code, message }
    }));
  }
}

function handleUpdateConnection(ws, data) {
    const { gameId, playerId } = data;
    
    console.log(`🔄 Updating WebSocket connection for player ${playerId} in game ${gameId}`);
    
    try {
      const game = GameService.getGame(gameId);
      if (!game) {
        throw new Error('Game not found');
      }
      
      // Find the player in the game and update their WebSocket connection
      const player = game.players.find(p => p.id === playerId);
      if (player) {
        console.log(`✅ Updated WebSocket for player ${playerId}`);
        player.ws = ws; // Update to new WebSocket connection
      }
      
      ws.send(JSON.stringify({
        type: 'connection_updated',
        data: { message: 'WebSocket connection updated successfully' }
      }));
      
    } catch (error) {
      console.error('Update connection error:', error);
      sendError(ws, 'UPDATE_FAILED', error.message);
    }
  }

module.exports = {
  handleMessage,
  handleDisconnection
};