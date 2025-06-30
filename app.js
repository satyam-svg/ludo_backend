const cors = require('cors');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// Import routes
const userRoutes = require('./routes/userRoutes');
const walletRoutes = require('./routes/walletRoutes');
const luckyNumberRoutes = require('./routes/luckyNumberRoutes');
const matkaRoutes = require('./routes/matkaRoutes');
const snakeRoutes = require('./routes/snakeRoutes');


// Import WebSocket handler and Game Manager
const { handleWebSocketMessage, handleDisconnection } = require('./webSocketHandler');
const GameManager = require('./gameManager');

const app = express();

// CORS and middleware setup
app.use(cors({
  origin: '*', // ✅ open to all
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));


app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Server is running properly'
  });
});

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes.router);
app.use('/api/lucky-number', luckyNumberRoutes);
app.use('/api/snake-game', snakeRoutes);
app.use('/api/matka-king', matkaRoutes);

// Game API Routes
app.get('/api/games/active', (req, res) => {
  try {
    const activeGames = GameManager.getActiveGames();
    res.json(activeGames);
  } catch (error) {
    console.error('Error fetching active games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/games/:gameId', (req, res) => {
  try {
    const game = GameManager.getGame(req.params.gameId);
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
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server Setup
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

console.log('🚀 Setting up WebSocket server...');

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  console.log('🔌 New WebSocket connection');

  // Optimize socket settings
  if (ws._socket) {
    ws._socket.setNoDelay(true);
    ws._socket.setTimeout(0);
  }

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const { type, data: messageData } = JSON.parse(data);
      handleWebSocketMessage(ws, type, messageData);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { code: 'INVALID_MESSAGE', message: 'Invalid message format' }
      }));
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
    handleDisconnection(ws);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    data: { message: 'Connected to game server' }
  }));
});

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready at ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, wss };