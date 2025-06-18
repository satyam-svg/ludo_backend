const cors = require('cors');
const express = require('express');
const userRoutes = require('./routes/userRoutes');
const luckyNumberRoutes = require('./routes/luckyNumber');

const app = express();
app.use(cors()); // 👈 allows all origins
app.use(express.json());

app.use('/api/users', userRoutes);
app.use('/api/lucky-number', luckyNumberRoutes);
app.use('/api/wallet', walletRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('\n📚 Available API Routes:');
  console.log('┌─────────────────────────────────────────────────────────┐');
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
  console.log('│                    UTILITIES                            │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│ GET    /health                    - Health check        │');
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log(`\n🌐 Test your API: http://localhost:${PORT}/health`);
});
