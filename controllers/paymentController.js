const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class PaymentController {

  static async createPendingDeposit(req, res) {
      try {
        const { amount, paymentMethod , indetifier} = req.body;
        const userId = req.user.id;
        // Check if user exists
        const user = await prisma.user.findUnique({
          where: { id: userId }
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Create transaction record
        const transaction = await prisma.transaction.create({
          data: {
            userId,
            amount: amount,
            type: 'deposit_pending',
            description: `Deposit via ${paymentMethod} and identifier ${indetifier}`,
          }
        });


        console.log(`💰 Pending deposit created: User ${userId} - ₹${amount} via ${paymentMethod}`);

        res.json({
          success: true,
          message: 'Deposit request created successfully'
        });

      } catch (error) {
        console.error('Error creating pending deposit:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    }


  static async getSpecificTransactions(req, res) {
    try {
      const userId = req.user.id;
      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Fetch transactions with specific types
      const transactions = await prisma.transaction.findMany({
        where: {
          userId,
          OR: [
            { type: { contains: 'deposit' } },
            { type: 'referral_bonus' },
            { type: 'signup_bonus' },
            {type : {contains: 'withdraw'}}
          ]
        },
        orderBy: { createdAt: 'desc' }
      });

      console.log(`📊 Fetched ${transactions.length} specific transactions for user ${userId}`);

      res.json({
        success: true,
        transactions
      });

    } catch (error) {
      console.error('Error fetching specific transactions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
    // Get user ID, phone number, wallet, and deposit amount for pending deposits
  static async getPendingDepositsSimple(req, res) {
    try {
      // Check for secret key authorization
      const secretKey = req.headers['x-secret-key'] || req.body.secretKey || req.query.secretKey;
      const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'your-super-secret-admin-key-here';
      
      if (!secretKey) {
        return res.status(401).json({
          success: false,
          error: 'Secret key is required'
        });
      }

      if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(403).json({
          success: false,
          error: 'Invalid secret key'
        });
      }

      // If secret key matches, proceed with the query
      const pendingDeposits = await prisma.transaction.findMany({
        where: {
          type: 'deposit_pending'
        },
        select: {
          id: true,        // transaction ID (if you need it for approval)
          amount: true,    // deposit amount
          createdAt: true, // add timestamp for reference
          description: true,
          user: {
            select: {
              id: true,           // user ID
              phoneNumber: true,  // phone number
              wallet: true        // current wallet balance
            }
          }
        },
        orderBy: {
          createdAt: 'asc' // oldest first
        }
      });

      // Format the result to flatten the structure
      const result = pendingDeposits.map(transaction => ({
        transactionId: transaction.id,
        userId: transaction.user.id,
        phoneNumber: transaction.user.phoneNumber,
        wallet: transaction.user.wallet,
        amount: transaction.amount,
        description: transaction.description, // for approval reference
        createdAt: transaction.createdAt
      }));

      return res.status(200).json({
        success: true,
        count: result.length,
        data: result
      });

    } catch (error) {
      console.error('Error fetching pending deposits:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }


  static async approveRejectPendingDeposit(req, res) {
    // Check secret key
    const secretKey = req.headers['x-secret-key'];
    const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'your-super-secret-admin-key-here';
    
    if (secretKey !== ADMIN_SECRET_KEY) {
      return res.status(403).json({ error: 'Invalid secret key' });
    }

    const { transactions } = req.body;
    
    // Process each transaction
    for (const txn of transactions) {
      const { id, status, amount } = txn;
      
      const transaction = await prisma.transaction.findUnique({
        where: { id: id},
        include: { user: true }
      });

      if (status === 'approve') {
        // Add amount to wallet and mark as completed
        await prisma.$transaction(async (prisma) => {
          await prisma.user.update({
            where: { id: transaction.user.id },
            data: { wallet: { increment: amount } }
          });

          await prisma.transaction.update({
            where: { id },
            data: { type: 'deposit_completed' }
          });
        });
      } else {
        // Just mark as rejected
        await prisma.transaction.update({
          where: { id },
          data: { type: 'deposit_rejected' }
        });
      }
    }

    res.json({ success: true });
    } 



  // Create pending withdrawal request
  static async createPendingWithdrawal(req, res) {
    try {
      const { amount, withdrawalMethod, accountDetails } = req.body;
      const userId = req.user.id;
      
      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if(amount<200){
        return res.status(400).json({ error: 'Minimum 200' });
      }

      // Check if user has sufficient balance
      if (user.wallet < amount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      await prisma.user.update({
              where: { id: userId },
              data: { wallet: { decrement: amount } }
            });

      // Create transaction record
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount: -amount, // Negative for withdrawal
          type: 'withdrawal_pending',
          description: `Withdrawal via ${withdrawalMethod} - ${JSON.stringify(accountDetails)}`,
        }
      });

      console.log(`💸 Pending withdrawal created: User ${userId} - ₹${amount} via ${withdrawalMethod}`);

      res.json({
        success: true,
        message: 'Withdrawal request created successfully'
      });

    } catch (error) {
      console.error('Error creating pending withdrawal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get pending withdrawals for admin
  static async getPendingWithdrawalsSimple(req, res) {
    try {
      // Check for secret key authorization
      const secretKey = req.headers['x-secret-key'] || req.body.secretKey || req.query.secretKey;
      const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'your-super-secret-admin-key-here';
      
      if (!secretKey) {
        return res.status(401).json({
          success: false,
          error: 'Secret key is required'
        });
      }

      if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(403).json({
          success: false,
          error: 'Invalid secret key'
        });
      }

      const pendingWithdrawals = await prisma.transaction.findMany({
        where: {
          type: 'withdrawal_pending'
        },
        select: {
          id: true,
          amount: true,
          createdAt: true,
          description: true,
          user: {
            select: {
              id: true,
              phoneNumber: true,
              wallet: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      const result = pendingWithdrawals.map(transaction => ({
        transactionId: transaction.id,
        userId: transaction.user.id,
        phoneNumber: transaction.user.phoneNumber,
        wallet: transaction.user.wallet,
        amount: Math.abs(transaction.amount), // Show positive amount
        description: transaction.description,
        createdAt: transaction.createdAt
      }));

      return res.status(200).json({
        success: true,
        count: result.length,
        data: result
      });

    } catch (error) {
      console.error('Error fetching pending withdrawals:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  // Approve/Reject withdrawal requests
  static async approveRejectPendingWithdrawal(req, res) {
    try {
      // Check secret key
      const secretKey = req.headers['x-secret-key'];
      const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'your-super-secret-admin-key-here';
      
      if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(403).json({ error: 'Invalid secret key' });
      }

      const { transactions } = req.body;
      
      // Process each transaction
      for (const txn of transactions) {
        const { id, status, amount } = txn;
        
        const transaction = await prisma.transaction.findUnique({
          where: { id: id },
          include: { user: true }
        });

        if (!transaction) {
          continue; // Skip if transaction not found
        }

        if (status === 'approve') {
          // Deduct amount from wallet and mark as completed
          await prisma.$transaction(async (prisma) => {
    
            await prisma.transaction.update({
              where: { id },
              data: { type: 'withdrawal_completed' }
            });

          });
        } else {

           await prisma.user.update({
              where: { id: transaction.user.id },
              data: { wallet: { increment: Math.abs(amount) } }
            });
          // Just mark as rejected (no wallet change needed)
          await prisma.transaction.update({
            where: { id },
            data: { type: 'withdrawal_rejected' }
          });
        }
      }

      res.json({ success: true, message: 'Withdrawals processed successfully' });

    } catch (error) {
      console.error('Error processing withdrawals:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

}



module.exports = { PaymentController };
