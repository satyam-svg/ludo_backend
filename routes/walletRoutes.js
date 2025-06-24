const express = require('express');
const router = express.Router();
const WalletController = require('../controllers/walletController');

// Authentication middleware (same as original)
const authenticateToken = (req, res, next) => {
  // TODO: Uncomment this when JWT is implemented
  /*
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
  */
  
  // TEMPORARY: Use hardcoded user for testing
  req.user = { 
    id: '24b0ae7d-e702-42c6-965e-df6b08a1b3e2'
  };
  next();
};

// Admin authentication middleware (placeholder)
const authenticateAdmin = (req, res, next) => {
  // TODO: Implement proper admin authentication
  // For now, just pass through
  next();
};

// ============= USER WALLET ROUTES =============

// Get wallet balance and recent transactions
router.get('/balance', authenticateToken, WalletController.getBalance);

// Check if user has sufficient balance for a stake
router.post('/check-balance', authenticateToken, WalletController.checkBalance);

// Deposit money to wallet
router.post('/deposit', authenticateToken, WalletController.deposit);

// Request withdrawal
router.post('/withdraw', authenticateToken, WalletController.withdraw);

// Get withdrawal history
router.get('/withdrawals', authenticateToken, WalletController.getWithdrawals);

// Get transaction history
router.get('/transactions', authenticateToken, WalletController.getTransactions);

// Get wallet summary/statistics
router.get('/summary', authenticateToken, WalletController.getWalletSummary);

// ============= UTILITY ROUTES =============

// Get current wallet balance (simple endpoint)
router.get('/balance/current', authenticateToken, async (req, res) => {
  try {
    const balance = await WalletController.checkWalletBalance(req.user.id);
    if (balance === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      success: true,
      balance
    });
  } catch (error) {
    console.error('Error getting current balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update wallet balance (utility endpoint - use with caution)
router.put('/balance/update', authenticateToken, async (req, res) => {
  try {
    const { newBalance } = req.body;
    
    if (typeof newBalance !== 'number' || newBalance < 0) {
      return res.status(400).json({ error: 'Invalid balance amount' });
    }

    await WalletController.updateWalletBalance(req.user.id, newBalance);
    
    res.json({
      success: true,
      message: 'Balance updated successfully',
      newBalance
    });
  } catch (error) {
    console.error('Error updating balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============= ADMIN ROUTES =============

// Get all pending withdrawals (admin only)
router.get('/admin/withdrawals/pending', authenticateAdmin, WalletController.getPendingWithdrawals);

// Approve/Reject withdrawal (admin only)
router.patch('/admin/withdrawal/:withdrawalId', authenticateAdmin, WalletController.processWithdrawal);

// Get all withdrawals (admin only)
router.get('/admin/withdrawals', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;
    
    const whereClause = {};
    if (status) whereClause.status = status;
    if (userId) whereClause.userId = userId;

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const withdrawals = await prisma.withdrawal.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            wallet: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    const totalWithdrawals = await prisma.withdrawal.count({
      where: whereClause
    });

    res.json({
      success: true,
      withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalWithdrawals,
        pages: Math.ceil(totalWithdrawals / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error getting admin withdrawals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all transactions (admin only)
router.get('/admin/transactions', authenticateAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, type, userId } = req.query;
    
    const whereClause = {};
    if (type) whereClause.type = type;
    if (userId) whereClause.userId = userId;

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    const totalTransactions = await prisma.transaction.count({
      where: whereClause
    });

    res.json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalTransactions,
        pages: Math.ceil(totalTransactions / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error getting admin transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get wallet statistics (admin only)
router.get('/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const [
      totalUsers,
      totalBalance,
      totalDeposits,
      totalWithdrawals,
      pendingWithdrawals,
      recentTransactions
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.aggregate({
        _sum: { wallet: true }
      }),
      prisma.transaction.aggregate({
        where: { type: 'deposit' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.withdrawal.aggregate({
        where: { status: 'completed' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.withdrawal.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.transaction.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      })
    ]);

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          totalBalance: totalBalance._sum.wallet || 0
        },
        deposits: {
          total: totalDeposits._sum.amount || 0,
          count: totalDeposits._count || 0
        },
        withdrawals: {
          completed: {
            total: totalWithdrawals._sum.amount || 0,
            count: totalWithdrawals._count || 0
          },
          pending: {
            total: pendingWithdrawals._sum.amount || 0,
            count: pendingWithdrawals._count || 0
          }
        },
        recentActivity: {
          transactionsLast24h: recentTransactions
        }
      }
    });

  } catch (error) {
    console.error('Error getting wallet stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  checkWalletBalance: WalletController.checkWalletBalance,
  updateWalletBalance: WalletController.updateWalletBalance
};