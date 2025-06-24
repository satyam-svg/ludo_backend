const GameManager = require('./gameManager');
const { checkWalletBalance, updateWalletBalance } = require('./routes/walletRoutes');

// WebSocket message handler
function handleWebSocketMessage(ws, type, data) {
  try {
    console.log(`📨 Handling: ${type}`, data);
    
    switch (type) {
      case 'create_game':
        handleCreateGame(ws, data);
        break;
      case 'join_game':
        handleJoinGame(ws, data);
        break;
      case 'join_queue':
        handleJoinQueue(ws, data);
        break;
      case 'roll_dice':
        handleRollDice(ws, data);
        break;
      case 'leave_game':
        handleLeaveGame(ws, data);
        break;
      case 'update_connection':
        handleUpdateConnection(ws, data);
        break;
      case 'ping':
        handlePing(ws);
        break;
      default:
        sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendError(ws, 'INTERNAL_ERROR', 'An error occurred processing your request');
  }
}

// Create game handler
async function handleCreateGame(ws, data) {
  const { playerId, playerName, stake, gameType } = data;
  
  if (gameType !== 'six_king') {
    sendError(ws, 'INVALID_GAME_TYPE', 'Only six_king game type is supported');
    return;
  }

  try {
    // Check wallet balance
    const userWallet = await checkWalletBalance(playerId);
    if (userWallet < parseInt(stake)) {
      sendError(ws, 'INSUFFICIENT_BALANCE', 'Please deposit to continue');
      return;
    }

    // Deduct stake from wallet
    await updateWalletBalance(playerId, userWallet - parseInt(stake));

    // Create game
    const playerData = {
      id: playerId,
      name: playerName,
      ws,
      stake: parseInt(stake)
    };

    const result = await GameManager.createGame(playerData);
    
    ws.send(JSON.stringify({
      type: 'game_created',
      data: result
    }));

    console.log(`✅ Game created: ${result.gameId} by ${playerName}`);
  } catch (error) {
    console.error('Create game error:', error);
    sendError(ws, 'CREATE_FAILED', error.message);
  }
}

// Join game handler
async function handleJoinGame(ws, data) {
  const { gameId, playerId, playerName, stake } = data;
  
  try {
    // Check wallet balance
    const userWallet = await checkWalletBalance(playerId);
    if (userWallet < parseInt(stake)) {
      sendError(ws, 'INSUFFICIENT_BALANCE', 'Please deposit to continue');
      return;
    }

    // Deduct stake from wallet
    await updateWalletBalance(playerId, userWallet - parseInt(stake));

    // Join game
    const playerData = {
      id: playerId,
      name: playerName,
      ws,
      stake: parseInt(stake)
    };

    const result = GameManager.joinGame(gameId, playerData);
    
    ws.send(JSON.stringify({
      type: 'game_joined',
      data: result
    }));

    console.log(`✅ Player ${playerName} joined game ${gameId}`);
  } catch (error) {
    console.error('Join game error:', error);
    sendError(ws, 'JOIN_FAILED', error.message);
  }
}

// Join queue handler
async function handleJoinQueue(ws, data) {
  const { playerId, playerName, stake } = data;
  
  try {
    // Check wallet balance
    const userWallet = await checkWalletBalance(playerId);
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

    const result = await GameManager.findMatch(playerData);
    
    if (result.matched) {
      // Deduct stakes from both players
      const newPlayerBalance = await checkWalletBalance(result.newPlayer.id);
      const waitingPlayerBalance = await checkWalletBalance(result.waitingPlayer.id);
      
      await updateWalletBalance(result.newPlayer.id, newPlayerBalance - stake);
      await updateWalletBalance(result.waitingPlayer.id, waitingPlayerBalance - stake);

      // Notify both players
      result.waitingPlayer.ws.send(JSON.stringify({
        type: 'game_matched',
        data: { 
          gameId: result.gameId, 
          opponent: { id: result.newPlayer.id, name: result.newPlayer.name },
          stake: result.stake
        }
      }));

      ws.send(JSON.stringify({
        type: 'game_matched',
        data: { 
          gameId: result.gameId, 
          opponent: { id: result.waitingPlayer.id, name: result.waitingPlayer.name },
          stake: result.stake
        }
      }));

      console.log(`🎯 Match created: ${result.gameId}`);
    } else {
      ws.send(JSON.stringify({
        type: 'queued',
        data: { message: result.message }
      }));
    }
  } catch (error) {
    console.error('Queue error:', error);
    sendError(ws, 'MATCH_FAILED', error.message);
  }
}

// Roll dice handler
function handleRollDice(ws, data) {
  const { gameId, playerId } = data;
  
  try {
    const result = GameManager.rollDice(gameId, playerId);
    console.log(`🎲 Dice rolled: ${result.diceValue}, Game ended: ${result.gameEnded}`);
  } catch (error) {
    console.error('Roll dice error:', error);
    sendError(ws, 'ROLL_FAILED', error.message);
  }
}

// Leave game handler
function handleLeaveGame(ws, data) {
  const { gameId, playerId } = data;
  
  try {
    GameManager.leaveGame(gameId, playerId);
    console.log(`👋 Player ${playerId} left game ${gameId}`);
  } catch (error) {
    console.error('Leave game error:', error);
  }
}

// Update connection handler
function handleUpdateConnection(ws, data) {
  const { gameId, playerId } = data;
  
  try {
    const updated = GameManager.updatePlayerConnection(gameId, playerId, ws);
    
    if (updated) {
      ws.send(JSON.stringify({
        type: 'connection_updated',
        data: { message: 'Connection updated successfully' }
      }));
    } else {
      sendError(ws, 'UPDATE_FAILED', 'Failed to update connection');
    }
  } catch (error) {
    console.error('Update connection error:', error);
    sendError(ws, 'UPDATE_FAILED', error.message);
  }
}

// Ping handler
function handlePing(ws) {
  ws.send(JSON.stringify({ 
    type: 'pong', 
    data: { timestamp: new Date().toISOString() } 
  }));
}

// Handle disconnection
function handleDisconnection(ws) {
  console.log('🔌 Player disconnected');
  const playerInfo = GameManager.getPlayerByWebSocket(ws);
  
  if (playerInfo) {
    console.log(`👋 Cleaning up for player ${playerInfo.playerId}`);
    GameManager.leaveGame(playerInfo.gameId, playerInfo.playerId);
  }
}

// Send error message
function sendError(ws, code, message) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify({
      type: 'error',
      data: { code, message }
    }));
  }
}

module.exports = {
  handleWebSocketMessage,
  handleDisconnection
};