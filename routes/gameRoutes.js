const games = new Map();
const players = new Map();
const waitingQueue = new Map();

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', (message) => {
    try {
      const { type, data } = JSON.parse(message);
      handleMessage(ws, type, data);
    } catch (error) {
      console.error('Error parsing message:', error);
      sendError(ws, 'INVALID_MESSAGE', 'Invalid message format');
    }
  });

  ws.on('close', () => {
    handleDisconnection(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function handleMessage(ws, type, data) {
  switch (type) {
    case 'create_game':
      handleCreateGame(ws, data);
      break;
    case 'join_game':
      handleJoinGame(ws, data);
      break;
    case 'roll_dice':
      handleRollDice(ws, data);
      break;
    case 'leave_game':
      handleLeaveGame(ws, data);
      break;
    case 'join_queue':
      handleJoinQueue(ws, data);
      break;
    default:
      sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${type}`);
  }
}

function handleCreateGame(ws, data) {
  const { playerId, playerName, stake, gameType } = data;
  
  if (gameType !== 'six_king') {
    sendError(ws, 'INVALID_GAME_TYPE', 'Only six_king game type is supported');
    return;
  }

  const gameId = generateGameCode();
  const player = {
    id: playerId,
    name: playerName,
    ws,
    stake: parseInt(stake)
  };

  const game = new SixKingGame(gameId, player, parseInt(stake));
  games.set(gameId, game);
  players.set(playerId, { player, gameId });

  ws.send(JSON.stringify({
    type: 'game_created',
    data: { gameId, stake: parseInt(stake) }
  }));
}

function handleJoinGame(ws, data) {
  const { gameId, playerId, playerName, stake } = data;
  
  const game = games.get(gameId);
  if (!game) {
    sendError(ws, 'GAME_NOT_FOUND', 'Game not found');
    return;
  }

  if (game.players.length >= 2) {
    sendError(ws, 'GAME_FULL', 'Game is full');
    return;
  }

  if (game.stake !== parseInt(stake)) {
    sendError(ws, 'STAKE_MISMATCH', 'Stake amount does not match game stake');
    return;
  }

  const player = {
    id: playerId,
    name: playerName,
    ws,
    stake: parseInt(stake)
  };

  try {
    game.broadcast('player_joined', {
      player: { id: playerId, name: playerName }
    });

    game.addPlayer(player);
    players.set(playerId, { player, gameId });

    ws.send(JSON.stringify({
      type: 'game_joined',
      data: {
        gameId,
        host: { id: game.players[0].id, name: game.players[0].name },
        stake: game.stake
      }
    }));

  } catch (error) {
    sendError(ws, 'JOIN_FAILED', error.message);
  }
}

function handleJoinQueue(ws, data) {
  const { playerId, playerName, stake } = data;
  
  const player = {
    id: playerId,
    name: playerName,
    ws,
    stake: parseInt(stake)
  };

  if (!waitingQueue.has(stake)) {
    waitingQueue.set(stake, []);
  }

  const queue = waitingQueue.get(stake);
  
  if (queue.length > 0) {
    const waitingPlayer = queue.shift();
    
    const gameId = generateGameCode();
    const game = new SixKingGame(gameId, waitingPlayer, parseInt(stake));
    
    try {
      game.addPlayer(player);
      games.set(gameId, game);
      
      players.set(waitingPlayer.id, { player: waitingPlayer, gameId });
      players.set(playerId, { player, gameId });

      waitingPlayer.ws.send(JSON.stringify({
        type: 'game_matched',
        data: { gameId, opponent: { id: playerId, name: playerName } }
      }));

      ws.send(JSON.stringify({
        type: 'game_matched',
        data: { gameId, opponent: { id: waitingPlayer.id, name: waitingPlayer.name } }
      }));

    } catch (error) {
      sendError(ws, 'MATCH_FAILED', error.message);
    }
  } else {
    queue.push(player);
    
    ws.send(JSON.stringify({
      type: 'queued',
      data: { message: 'Waiting for opponent with matching stake...' }
    }));
  }
}

function handleRollDice(ws, data) {
  const { gameId, playerId } = data;
  const game = games.get(gameId);
  
  if (!game) {
    sendError(ws, 'GAME_NOT_FOUND', 'Game not found');
    return;
  }

  try {
    const result = game.rollDice(playerId);
    
    if (result.gameEnded) {
      setTimeout(() => {
        games.delete(gameId);
        game.players.forEach(p => players.delete(p.id));
      }, 5000);
    }
  } catch (error) {
    sendError(ws, 'ROLL_FAILED', error.message);
  }
}

function handleLeaveGame(ws, data) {
  const { gameId, playerId } = data;
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

function handleDisconnection(ws) {
  let disconnectedPlayerId = null;
  let gameId = null;

  for (const [playerId, playerData] of players) {
    if (playerData.player.ws === ws) {
      disconnectedPlayerId = playerId;
      gameId = playerData.gameId;
      break;
    }
  }

  if (disconnectedPlayerId && gameId) {
    handleLeaveGame(ws, { gameId, playerId: disconnectedPlayerId });
  }
}

function sendError(ws, code, message) {
  ws.send(JSON.stringify({
    type: 'error',
    data: { code, message }
  }));
}

function generateGameCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get('/api/games/active', (req, res) => {
    const activeGames = Array.from(games.values()).map(game => ({
      gameId: game.gameId,
      stake: game.stake,
      players: game.players.length,
      state: game.state,
      createdAt: game.createdAt
    }));
    
    res.json(activeGames);
  });
  
  app.get('/api/games/:gameId', (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    res.json({
      gameId: game.gameId,
      stake: game.stake,
      players: game.players.map(p => ({ id: p.id, name: p.name })),
      state: game.state,
      scores: game.scores,
      currentTurn: game.currentTurn,
      rollCount: game.rollCount
    });
  });