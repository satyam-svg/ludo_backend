// routes/wallet.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// TEMPORARY: Bypass authentication middleware (same as your lucky number)
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
  
  // TEMPORARY: Use the same hardcoded user for testing
  req.user = { 
    id: '24b0ae7d-e702-42c6-965e-df6b08a1b3e2' // Same as your lucky number game
  };
  next();
};

// Get wallet balance and recent transactions
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user with current balance
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        wallet: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get recent transactions (last 10)
    const recentTransactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        type: true,
        description: true,
        createdAt: true
      }
    });

    // Get pending withdrawals
    const pendingWithdrawals = await prisma.withdrawal.findMany({
      where: { 
        userId,
        status: 'pending'
      },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      wallet: {
        balance: user.wallet,
        userId: user.id,
        email: user.email
      },
      recentTransactions,
      pendingWithdrawals
    });

  } catch (error) {
    console.error('Error getting wallet balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if user has sufficient balance for a stake
router.post('/check-balance', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { wallet: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasSufficientBalance = user.wallet >= parseFloat(amount);

    res.json({
      success: true,
      hasSufficientBalance,
      currentBalance: user.wallet,
      requestedAmount: parseFloat(amount),
      shortfall: hasSufficientBalance ? 0 : parseFloat(amount) - user.wallet
    });

  } catch (error) {
    console.error('Error checking balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deposit money to wallet
router.post('/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, paymentMethod, transactionReference } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid deposit amount' });
    }

    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method required' });
    }

    const depositAmount = parseFloat(amount);

    // Validate deposit limits (optional)
    if (depositAmount < 10) {
      return res.status(400).json({ error: 'Minimum deposit is ₹10' });
    }

    if (depositAmount > 50000) {
      return res.status(400).json({ error: 'Maximum deposit is ₹50,000' });
    }

    // Get current user balance
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newBalance = user.wallet + depositAmount;

    // Update wallet and create transaction record
    const result = await prisma.$transaction(async (prisma) => {
      // Update user wallet
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { wallet: newBalance }
      });

      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount: depositAmount,
          type: 'deposit',
          description: `Deposit via ${paymentMethod}${transactionReference ? ` - Ref: ${transactionReference}` : ''}`,
        }
      });

      return { updatedUser, transaction };
    });

    console.log(`💰 Deposit successful: User ${userId} deposited ₹${depositAmount}`);

    res.json({
      success: true,
      message: 'Deposit successful',
      wallet: {
        previousBalance: user.wallet,
        depositAmount,
        newBalance: result.updatedUser.wallet
      },
      transaction: {
        id: result.transaction.id,
        amount: result.transaction.amount,
        type: result.transaction.type,
        createdAt: result.transaction.createdAt
      }
    });

  } catch (error) {
    console.error('Error processing deposit:', error);
    
    if (error.code === 'P2028') {
      return res.status(503).json({ error: 'Database is busy, please try again' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Request withdrawal
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, withdrawalMethod, accountDetails } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid withdrawal amount' });
    }

    if (!withdrawalMethod) {
      return res.status(400).json({ error: 'Withdrawal method required' });
    }

    const withdrawalAmount = parseFloat(amount);

    // Validate withdrawal limits
    if (withdrawalAmount < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is ₹100' });
    }

    if (withdrawalAmount > 25000) {
      return res.status(400).json({ error: 'Maximum withdrawal is ₹25,000' });
    }

    // Get current user balance
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check sufficient balance
    if (user.wallet < withdrawalAmount) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        currentBalance: user.wallet,
        requestedAmount: withdrawalAmount
      });
    }

    // Check for existing pending withdrawals
    const pendingWithdrawals = await prisma.withdrawal.findMany({
      where: {
        userId,
        status: 'pending'
      }
    });

    const totalPendingAmount = pendingWithdrawals.reduce((sum, w) => sum + w.amount, 0);
    const availableBalance = user.wallet - totalPendingAmount;

    if (availableBalance < withdrawalAmount) {
      return res.status(400).json({ 
        error: 'Insufficient available balance (pending withdrawals)',
        currentBalance: user.wallet,
        pendingAmount: totalPendingAmount,
        availableBalance: availableBalance,
        requestedAmount: withdrawalAmount
      });
    }

    // Create withdrawal request
    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId,
        amount: withdrawalAmount,
        status: 'pending',
        // You can add more fields like withdrawalMethod, accountDetails etc.
      }
    });

    // Create transaction record for tracking
    await prisma.transaction.create({
      data: {
        userId,
        amount: -withdrawalAmount, // Negative for withdrawal
        type: 'withdrawal_request',
        description: `Withdrawal request via ${withdrawalMethod} - Request ID: ${withdrawal.id}`,
      }
    });

    console.log(`📤 Withdrawal requested: User ${userId} requested ₹${withdrawalAmount}`);

    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      withdrawal: {
        id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        createdAt: withdrawal.createdAt,
        estimatedProcessingTime: '1-3 business days'
      },
      wallet: {
        currentBalance: user.wallet,
        pendingWithdrawals: totalPendingAmount + withdrawalAmount,
        availableBalance: user.wallet - (totalPendingAmount + withdrawalAmount)
      }
    });

  } catch (error) {
    console.error('Error processing withdrawal:', error);
    
    if (error.code === 'P2028') {
      return res.status(503).json({ error: 'Database is busy, please try again' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get withdrawal history
router.get('/withdrawals', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });

    const totalWithdrawals = await prisma.withdrawal.count({
      where: { userId }
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
    console.error('Error getting withdrawals:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;

    const whereClause = { userId };
    if (type) {
      whereClause.type = type;
    }

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
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
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin route: Approve/Reject withdrawal (you can add admin auth later)
router.patch('/admin/withdrawal/:withdrawalId', async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { action, adminNote } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use approve or reject' });
    }

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true }
    });

    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'Withdrawal already processed' });
    }

    if (action === 'approve') {
      // Approve withdrawal - deduct money from wallet
      const result = await prisma.$transaction(async (prisma) => {
        // Update withdrawal status
        const updatedWithdrawal = await prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: { 
            status: 'completed',
            // updatedAt will be set automatically
          }
        });

        // Deduct amount from user wallet
        const updatedUser = await prisma.user.update({
          where: { id: withdrawal.userId },
          data: { 
            wallet: withdrawal.user.wallet - withdrawal.amount 
          }
        });

        // Create completion transaction record
        await prisma.transaction.create({
          data: {
            userId: withdrawal.userId,
            amount: -withdrawal.amount,
            type: 'withdrawal_completed',
            description: `Withdrawal completed - Request ID: ${withdrawal.id}${adminNote ? ` - Note: ${adminNote}` : ''}`,
          }
        });

        return { updatedWithdrawal, updatedUser };
      });

      res.json({
        success: true,
        message: 'Withdrawal approved and processed',
        withdrawal: result.updatedWithdrawal,
        newUserBalance: result.updatedUser.wallet
      });

    } else {
      // Reject withdrawal - just update status
      const updatedWithdrawal = await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'rejected' }
      });

      // Create rejection transaction record
      await prisma.transaction.create({
        data: {
          userId: withdrawal.userId,
          amount: 0, // No money change for rejection
          type: 'withdrawal_rejected',
          description: `Withdrawal rejected - Request ID: ${withdrawal.id}${adminNote ? ` - Reason: ${adminNote}` : ''}`,
        }
      });

      res.json({
        success: true,
        message: 'Withdrawal rejected',
        withdrawal: updatedWithdrawal
      });
    }

  } catch (error) {
    console.error('Error processing withdrawal action:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;