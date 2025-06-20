const cors = require('cors');
const express = require('express');
const userRoutes = require('./routes/userRoutes');
const luckyNumberRoutes = require('./routes/luckyNumber');
const walletRoutes = require('./routes/wallet');

const app = express();

// Enhanced CORS configuration for React Native
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', { ...req.body, password: req.body.password ? '[HIDDEN]' : undefined });
  }
  next();
});

app.use(express.json());

// Add response headers for better compatibility
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  next();
});

// Health check endpoint (add this before your routes)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Server is running properly',
    endpoints: {
      users: '/api/users/*',
      wallet: '/api/wallet/*',
      luckyNumber: '/api/lucky-number/*',
      games: '/api/games/*'
    }
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path
  });
});

// Your existing routes
app.use('/api/users', userRoutes);
app.use('/api/lucky-number', luckyNumberRoutes);
app.use('/api/wallet', walletRoutes);

// WebSocket setup
const http = require('http');
const WebSocket = require('ws');
const { handleMessage,handleDisconnection } = require('./websocket/gameHandlers');
const GameService = require('./services/GameService');

// Create HTTP server from your Express app
const server = http.createServer(app);

// Add WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws' // Optional: specify WebSocket path
});

console.log('Setting up WebSocket server...');

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress);

  if (ws._socket) {
    ws._socket.setNoDelay(true);
    ws._socket.setTimeout(0);
  }

  ws.on('message', function message(data) {
    try {
      const parsedMessage = JSON.parse(data);
      const { type, data: messageData } = parsedMessage;
      
      // Add immediate processing flag for game messages
      if (['roll_dice', 'dice_rolled', 'turn_changed'].includes(type)) {
        setImmediate(() => {
          handleMessage(ws, type, messageData);
        });
      } else {
        handleMessage(ws, type, messageData);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    handleDisconnection(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    data: { message: 'Connected to game server' }
  }));
});

// Add game API routes
app.get('/api/games/active', (req, res) => {
  try {
    const activeGames = GameService.getActiveGames();
    res.json(activeGames);
  } catch (error) {
    console.error('Error fetching active games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/games/:gameId', (req, res) => {
  try {
    const game = GameService.getGame(req.params.gameId);
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

// Error handling middleware (add this after all routes)
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});


const PORT = process.env.PORT || 5000;

// Updated server.listen with better configuration
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 HTTP API: http://localhost:${PORT}/api`);
  console.log(`🌐 External API: http://192.168.1.19:${PORT}/api`);
  console.log(`🎮 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/test`);
  
  console.log('\n📚 Available API Routes:');
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│                    USER ROUTES                          │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│ POST   /api/users/signup          - Register new user   │');
  console.log('│ POST   /api/users/login           - User login          │');
  console.log('│ POST   /api/users/verify-otp      - Verify OTP          │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│                    WALLET ROUTES                        │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│ GET    /api/wallet/balance        - Get wallet balance  │');
  console.log('│ POST   /api/wallet/check-balance  - Check if has money  │');
  console.log('│ POST   /api/wallet/deposit        - Deposit money       │');
  console.log('│ POST   /api/wallet/withdraw       - Request withdrawal  │');
  console.log('│ GET    /api/wallet/transactions   - Transaction history │');
  console.log('│ GET    /api/wallet/withdrawals    - Withdrawal history  │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│                 LUCKY NUMBER GAME                       │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│ POST   /api/lucky-number/start    - Start new game      │');
  console.log('│ POST   /api/lucky-number/roll     - Roll dice           │');
  console.log('│ POST   /api/lucky-number/finalize - Finalize game       │');
  console.log('│ GET    /api/lucky-number/status   - Get game status     │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│                 MULTIPLAYER GAMES                       │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│ GET    /api/games/active          - Get active games    │');
  console.log('│ GET    /api/games/:gameId         - Get game details    │');
  console.log('│ WS     /ws                        - WebSocket endpoint  │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│                    UTILITIES                            │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│ GET    /health                    - Health check        │');
  console.log('│ GET    /api/test                  - API test endpoint   │');
  console.log('└─────────────────────────────────────────────────────────┘');
  
  console.log(`\n🌐 Test your API:`);
  console.log(`   Local: http://localhost:${PORT}/health`);
  console.log(`   Network: http://192.168.1.19:${PORT}/health`);
  console.log(`\n📱 For React Native, use: http://192.168.1.19:${PORT}/api/users`);
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