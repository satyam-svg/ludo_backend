const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cron = require('node-cron');
const moment = require('moment-timezone');

// Slot configurations
const SLOT_CONFIGS = [
  { start: '09:00', end: '11:00', name: '9:00 AM - 11:00 AM' },
  { start: '09:30', end: '11:30', name: '9:30 AM - 11:30 AM' },
  { start: '11:00', end: '13:00', name: '11:00 AM - 1:00 PM' },
  { start: '12:00', end: '14:00', name: '12:00 PM - 2:00 PM' },
  { start: '14:00', end: '16:00', name: '2:00 PM - 4:00 PM' },
  { start: '15:00', end: '17:00', name: '3:00 PM - 5:00 PM' },
  { start: '17:00', end: '19:00', name: '5:00 PM - 7:00 PM' },
  { start: '18:00', end: '20:00', name: '6:00 PM - 8:00 PM' }
];

// Generate secure random number
const secureRandom = (min, max) => {
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return min + (randomValue % (max - min + 1));
};

// Initialize daily slots in database
const initializeDailySlots = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < SLOT_CONFIGS.length; i++) {
      const config = SLOT_CONFIGS[i];
      const slotId = `slot_${i}`;
      
      // Check if slot already exists for today
      const existingSlot = await prisma.matkaSlot.findFirst({
        where: {
          slotId,
          slotDate: today
        }
      });
      
      if (!existingSlot) {
        await prisma.matkaSlot.create({
          data: {
            slotId,
            slotName: config.name,
            slotDate: today,
            startTime: config.start,
            endTime: config.end,
            status: 'upcoming'
          }
        });
        console.log(`Created slot: ${config.name} for ${today.toISOString().split('T')[0]}`);
      }
    }
  } catch (error) {
    console.error('Error initializing daily slots:', error);
  }
};

// Update slot statuses based on current time
const updateSlotStatuses = async () => {
  try {
    const now = moment().tz('Asia/Kolkata');
    const currentTime = now.format('HH:mm');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get all slots for today
    const slots = await prisma.matkaSlot.findMany({
      where: {
        slotDate: today
      }
    });
    
    for (const slot of slots) {
      let newStatus = slot.status;
      
      // Determine new status based on current time
      if (currentTime >= slot.startTime && currentTime < slot.endTime) {
        newStatus = 'open';
      } else if (currentTime >= slot.endTime) {
        newStatus = 'closed';
        
        // Generate result if slot just closed and doesn't have a result
        if (slot.status !== 'closed' && slot.result === null) {
          const winningNumber = secureRandom(0, 9);
          
          await prisma.matkaSlot.update({
            where: { id: slot.id },
            data: { 
              status: newStatus,
              result: winningNumber 
            }
          });
          
          console.log(`Slot ${slot.slotName} closed with winning number: ${winningNumber}`);
          
          // Process all bets for this slot
          await processSlotResults(slot.id, winningNumber);
          continue;
        }
      } else {
        newStatus = 'upcoming';
      }
      
      // Update status if changed
      if (newStatus !== slot.status) {
        await prisma.matkaSlot.update({
          where: { id: slot.id },
          data: { status: newStatus }
        });
      }
    }
  } catch (error) {
    console.error('Error updating slot statuses:', error);
  }
};

// Process results when slot closes
const processSlotResults = async (slotId, winningNumber) => {
  try {
    console.log(`Processing results for slot ${slotId}, winning number: ${winningNumber}`);
    
    // Get all bets for this slot
    const bets = await prisma.matkaBet.findMany({
      where: {
        matkaSlotId: slotId,
        status: 'pending'
      },
      include: {
        user: true,
        slot: true
      }
    });
    
    // Process each bet
    for (const bet of bets) {
      const won = bet.selectedNumber === winningNumber;
      const winAmount = won ? bet.stakeAmount * 9.5 : 0;
      const transactionAmount = won ? winAmount : 0;
      
      await prisma.$transaction(async (prisma) => {
        // Update bet status and win amount
        await prisma.matkaBet.update({
          where: { id: bet.id },
          data: {
            status: won ? 'won' : 'lost',
            winAmount: winAmount
          }
        });
        
        // If user won, add winnings to wallet and create transaction
        if (won) {
          await prisma.user.update({
            where: { id: bet.userId },
            data: { wallet: { increment: winAmount } }
          });
          
          await prisma.transaction.create({
            data: {
              userId: bet.userId,
              amount: winAmount,
              type: 'matka_win',
              description: `Matka King Win - ${bet.slot.slotName} - Number: ${bet.selectedNumber}, Winning: ${winningNumber}`
            }
          });
          
          console.log(`User ${bet.userId} won ₹${winAmount} in slot ${bet.slot.slotName}`);
        } else {
          console.log(`User ${bet.userId} lost ₹${bet.stakeAmount} in slot ${bet.slot.slotName}`);
        }
      });
    }
    
    console.log(`Processed ${bets.length} bets for slot ${slotId}`);
  } catch (error) {
    console.error('Error processing slot results:', error);
  }
};

// Get all available slots
exports.getSlots = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Initialize slots if needed
    await initializeDailySlots();
    
    // Update slot statuses
    await updateSlotStatuses();
    
    // Get all slots for today with user bets
    const slots = await prisma.matkaSlot.findMany({
      where: {
        slotDate: today
      },
      include: {
        bets: {
          where: {
            userId: userId
          }
        },
        _count: {
          select: {
            bets: true
          }
        }
      },
      orderBy: {
        startTime: 'asc'
      }
    });
    
    // Format response data
    const formattedSlots = slots.map(slot => {
      const userBet = slot.bets.length > 0 ? slot.bets[0] : null;
      
      // Convert time strings to decimal for frontend compatibility
      const startTimeDecimal = timeStringToDecimal(slot.startTime);
      const endTimeDecimal = timeStringToDecimal(slot.endTime);
      
      return {
        id: slot.id,
        name: slot.slotName,
        status: slot.status,
        participants: slot._count.bets,
        winningNumber: slot.result,
        payout: 9.5,
        startTime: startTimeDecimal,
        endTime: endTimeDecimal,
        userBet: userBet ? {
          number: userBet.selectedNumber,
          amount: userBet.stakeAmount,
          gameId: userBet.id,
          status: userBet.status,
          winAmount: userBet.winAmount
        } : null
      };
    });
    
    res.json({
      success: true,
      slots: formattedSlots
    });
    
  } catch (error) {
    console.error('Error getting slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Helper function to convert time string to decimal
const timeStringToDecimal = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours + (minutes / 60);
};

// Place a bet
exports.placeBet = async (req, res) => {
  try {
    const { slotId, number, amount } = req.body;
    const userId = req.user.id;
    
    // Validation
    if (!slotId || number === undefined || !amount) {
      return res.status(400).json({ error: 'Slot ID, number, and amount are required' });
    }
    
    const selectedNumber = parseInt(number);
    const betAmount = parseFloat(amount);
    
    if (isNaN(selectedNumber) || selectedNumber < 0 || selectedNumber > 9) {
      return res.status(400).json({ error: 'Number must be between 0-9' });
    }
    
    if (isNaN(betAmount) || betAmount < 10) {
      return res.status(400).json({ error: 'Minimum bet amount is ₹10' });
    }
    
    // Get slot
    const slot = await prisma.matkaSlot.findUnique({
      where: { id: slotId }
    });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    // Update slot status and check if it's open
    await updateSlotStatuses();
    
    const updatedSlot = await prisma.matkaSlot.findUnique({
      where: { id: slotId }
    });
    
    if (updatedSlot.status !== 'open') {
      return res.status(400).json({ error: 'Slot is not open for betting' });
    }
    
    // Check if user already has a bet in this slot
    const existingBet = await prisma.matkaBet.findFirst({
      where: {
        userId: userId,
        matkaSlotId: slotId
      }
    });
    
    if (existingBet) {
      return res.status(400).json({ error: 'You already have a bet in this slot' });
    }
    
    // Check user balance
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.wallet < betAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Place bet and deduct amount
    const result = await prisma.$transaction(async (prisma) => {
      // Deduct stake from user wallet
      await prisma.user.update({
        where: { id: userId },
        data: { wallet: { decrement: betAmount } }
      });
      
      // Create transaction record for bet placement
      await prisma.transaction.create({
        data: {
          userId,
          amount: -betAmount,
          type: 'matka_bet',
          description: `Matka King Bet - ${slot.slotName} - Number: ${selectedNumber}, Amount: ₹${betAmount}`
        }
      });
      
      // Create bet record
      const bet = await prisma.matkaBet.create({
        data: {
          userId,
          matkaSlotId: slotId,
          selectedNumber,
          stakeAmount: betAmount,
          status: 'pending'
        }
      });
      
      return { bet, newBalance: user.wallet - betAmount };
    });
    
    res.json({
      success: true,
      message: 'Bet placed successfully',
      betId: result.bet.id,
      newBalance: result.newBalance,
      slotInfo: {
        id: slotId,
        name: slot.slotName,
        status: updatedSlot.status
      }
    });
    
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get user's game sessions (bets)
exports.getUserSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20 } = req.query;
    
    const bets = await prisma.matkaBet.findMany({
      where: {
        userId: userId
      },
      include: {
        slot: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });
    
    const sessions = bets.map(bet => ({
      gameId: bet.id,
      slotName: bet.slot.slotName,
      luckyNumber: bet.selectedNumber,
      stake: bet.stakeAmount,
      gameState: bet.status === 'pending' ? 'active' : 'completed',
      winAmount: bet.winAmount || 0,
      won: bet.status === 'won',
      winningNumber: bet.slot.result,
      finalAmount: bet.status === 'won' ? bet.winAmount : -bet.stakeAmount,
      createdAt: bet.createdAt
    }));
    
    res.json({
      success: true,
      sessions
    });
    
  } catch (error) {
    console.error('Error getting user sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get specific bet details
exports.getGameSession = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;
    
    const bet = await prisma.matkaBet.findUnique({
      where: { id: gameId },
      include: {
        slot: true,
        user: true
      }
    });
    
    if (!bet) {
      return res.status(404).json({ error: 'Bet not found' });
    }
    
    if (bet.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    
    const session = {
      gameId: bet.id,
      slotName: bet.slot.slotName,
      slotStatus: bet.slot.status,
      luckyNumber: bet.selectedNumber,
      stake: bet.stakeAmount,
      gameState: bet.status === 'pending' ? 'active' : 'completed',
      winAmount: bet.winAmount || 0,
      won: bet.status === 'won',
      winningNumber: bet.slot.result,
      finalAmount: bet.status === 'won' ? bet.winAmount : -bet.stakeAmount,
      createdAt: bet.createdAt
    };
    
    res.json({
      success: true,
      session
    });
    
  } catch (error) {
    console.error('Error getting game session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Initialize slots on server start
const initializeSystem = async () => {
  try {
    await initializeDailySlots();
    console.log('Matka King system initialized');
  } catch (error) {
    console.error('Error initializing Matka King system:', error);
  }
};

// Cron jobs for slot management
// Initialize daily slots at midnight
cron.schedule('0 0 * * *', () => {
  console.log('Initializing daily slots...');
  initializeDailySlots();
});

// Update slot statuses every minute
cron.schedule('* * * * *', () => {
  updateSlotStatuses();
});

// Initialize system on startup
initializeSystem();

module.exports = {
  getSlots: exports.getSlots,
  placeBet: exports.placeBet,
  getUserSessions: exports.getUserSessions,
  getGameSession: exports.getGameSession
};