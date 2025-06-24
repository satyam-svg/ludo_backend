const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class WalletController {
  // Helper method to check wallet balance
  static async checkWalletBalance(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { wallet: true }
      });
      return user ? user.wallet : null;
    } catch (error) {
      console.error('Error checking wallet balance:', error);
      throw error;
    }
  }

  // Helper method to update wallet balance
  static async updateWalletBalance(userId, newBalance) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { wallet: newBalance }
      });
      return true;
    } catch (error) {
      console.error('Error updating wallet balance:', error);
      throw error;
    }
  }

  // Get wallet balance and recent transactions
  static async getBalance(req, res) {
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
  }

  // Check if user has sufficient balance for a stake
  static async checkBalance(req, res) {
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
  }

  // Deposit money to wallet
  static async deposit(req, res) {
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

      // Validate deposit limits
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
  }

  // Request withdrawal
  static async withdraw(req, res) {
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
          withdrawalMethod,
          accountDetails: JSON.stringify(accountDetails) // Store as JSON string
        }
      });

      // Create transaction record for tracking
      await prisma.transaction.create({
        data: {
          userId,
          amount: -withdrawalAmount,
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
  }

  // Get withdrawal history
  static async getWithdrawals(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10, status } = req.query;

      const whereClause = { userId };
      if (status) {
        whereClause.status = status;
      }

      const withdrawals = await prisma.withdrawal.findMany({
        where: whereClause,
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
      console.error('Error getting withdrawals:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get transaction history
  static async getTransactions(req, res) {
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
  }

  // Get wallet summary/statistics
  static async getWalletSummary(req, res) {
    try {
      const userId = req.user.id;

      // Get current balance
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { wallet: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get transaction statistics
      const [totalDeposits, totalWithdrawals, totalTransactions] = await Promise.all([
        prisma.transaction.aggregate({
          where: { userId, type: 'deposit' },
          _sum: { amount: true },
          _count: true
        }),
        prisma.transaction.aggregate({
          where: { userId, type: { in: ['withdrawal_completed', 'withdrawal_request'] } },
          _sum: { amount: true },
          _count: true
        }),
        prisma.transaction.count({
          where: { userId }
        })
      ]);

      // Get pending withdrawals
      const pendingWithdrawals = await prisma.withdrawal.aggregate({
        where: { userId, status: 'pending' },
        _sum: { amount: true },
        _count: true
      });

      res.json({
        success: true,
        summary: {
          currentBalance: user.wallet,
          totalDeposited: totalDeposits._sum.amount || 0,
          totalWithdrawn: Math.abs(totalWithdrawals._sum.amount || 0),
          totalTransactions,
          pendingWithdrawals: {
            amount: pendingWithdrawals._sum.amount || 0,
            count: pendingWithdrawals._count || 0
          },
          availableBalance: user.wallet - (pendingWithdrawals._sum.amount || 0)
        }
      });

    } catch (error) {
      console.error('Error getting wallet summary:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Admin: Get all pending withdrawals
  static async getPendingWithdrawals(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;

      const withdrawals = await prisma.withdrawal.findMany({
        where: { status: 'pending' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              wallet: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }, // Oldest first for processing
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      });

      const totalPending = await prisma.withdrawal.count({
        where: { status: 'pending' }
      });

      res.json({
        success: true,
        withdrawals,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalPending,
          pages: Math.ceil(totalPending / parseInt(limit))
        }
      });

    } catch (error) {
      console.error('Error getting pending withdrawals:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Admin: Approve/Reject withdrawal
  static async processWithdrawal(req, res) {
    try {
      const { withdrawalId } = req.params;
      const { action, adminNote } = req.body;

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
        // Check if user still has sufficient balance
        if (withdrawal.user.wallet < withdrawal.amount) {
          return res.status(400).json({ 
            error: 'User has insufficient balance for this withdrawal',
            currentBalance: withdrawal.user.wallet,
            withdrawalAmount: withdrawal.amount
          });
        }

        const result = await prisma.$transaction(async (prisma) => {
          // Update withdrawal status
          const updatedWithdrawal = await prisma.withdrawal.update({
            where: { id: withdrawalId },
            data: { 
              status: 'completed',
              adminNote
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
        // Reject withdrawal
        const updatedWithdrawal = await prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: { 
            status: 'rejected',
            adminNote
          }
        });

        // Create rejection transaction record
        await prisma.transaction.create({
          data: {
            userId: withdrawal.userId,
            amount: 0,
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
  }
}

module.exports = WalletController;