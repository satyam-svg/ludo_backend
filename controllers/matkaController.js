const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cron = require('node-cron');

// Slot configuration - 7 slots per day, 3.5 hours each
const DAILY_SLOT_CONFIGS = [
  { name: '12:00 AM - 3:30 AM', startHour: 0, startMinute: 0, durationHours: 3.5 },
  { name: '3:30 AM - 7:00 AM', startHour: 3, startMinute: 30, durationHours: 3.5 },
  { name: '7:00 AM - 10:30 AM', startHour: 7, startMinute: 0, durationHours: 3.5 },
  { name: '10:30 AM - 2:00 PM', startHour: 10, startMinute: 30, durationHours: 3.5 },
  { name: '2:00 PM - 5:30 PM', startHour: 14, startMinute: 0, durationHours: 3.5 },
  { name: '5:30 PM - 9:00 PM', startHour: 17, startMinute: 30, durationHours: 3.5 },
  { name: '9:00 PM - 12:30 AM', startHour: 21, startMinute: 0, durationHours: 3.5 }
];

// Generate slots for next 3 days (to always have future slots available)
const generateSlotsForDays = async (days = 3) => {
  try {
    const now = new Date();
    
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      
      for (const config of DAILY_SLOT_CONFIGS) {
        const startTime = new Date(targetDate);
        startTime.setHours(config.startHour, config.startMinute, 0, 0);
        
        const endTime = new Date(startTime);
        const durationMs = config.durationHours * 60 * 60 * 1000;
        endTime.setTime(endTime.getTime() + durationMs);
        
        // Check if slot already exists
        const existingSlot = await prisma.matkaSlot.findFirst({
          where: {
            startTime: startTime,
            endTime: endTime
          }
        });
        
        if (!existingSlot) {
          await prisma.matkaSlot.create({
            data: {
              slotName: config.name,
              startTime: startTime,
              endTime: endTime,
              status: 'upcoming'
            }
          });
          console.log(`✅ Created slot: ${config.name} for ${targetDate.toDateString()}`);
        }
      }
    }
  } catch (error) {
    console.error('Error generating slots:', error);
  }
};

// Update slot statuses based on current time
const updateSlotStatuses = async () => {
  try {
    const now = new Date();
    
    // Update slots to 'open' if current time is between start and end
    await prisma.matkaSlot.updateMany({
      where: {
        startTime: { lte: now },
        endTime: { gt: now },
        status: { in: ['upcoming'] }
      },
      data: { status: 'open' }
    });
    
    // Get slots that just closed (status was 'open' but end time has passed)
    const slotsToClose = await prisma.matkaSlot.findMany({
      where: {
        endTime: { lte: now },
        status: 'open'
      }
    });
    
    // Process each closing slot
    for (const slot of slotsToClose) {
      await closeSlotAndGenerateResult(slot.id);
    }
    
  } catch (error) {
    console.error('Error updating slot statuses:', error);
  }
};

// Close slot and generate result
const closeSlotAndGenerateResult = async (slotId) => {
  try {
    const allBets = await prisma.matkaBet.findMany({
          where: { matkaSlotId: slot.id },
          select: {
            stakeAmount: true,
            selectedNumber: true
            }
          });

    const stakes = new Map();
    const counts = new Map();
    let totalBet = 0;

    for (const { stakeAmount, selectedNumber } of allBets) {
      totalBet += stakeAmount;
      stakes.set(selectedNumber, (stakes.get(selectedNumber) || 0) + stakeAmount);
      counts.set(selectedNumber, (counts.get(selectedNumber) || 0) + 1);
    }

    const eligibleNumbers = Array.from({ length: 10 }, (_, i) => i)
      .filter(number => (stakes.get(number) || 0) * 10 <= totalBet);

    let winningNumber;

    if (eligibleNumbers.length > 0) {
      winningNumber = eligibleNumbers[Math.floor(Math.random() * eligibleNumbers.length)];
    } else {
      // fallback: pick any number
      winningNumber = Math.floor(Math.random() * 10);
    }
    
    // Update slot with result
    await prisma.matkaSlot.update({
      where: { id: slotId },
      data: { 
        status: 'closed',
        result: winningNumber
      }
    });
    
    // Process all bets
    await processBetResults(slotId, winningNumber);
    
    console.log(`🎯 Slot ${slotId} closed with winning number: ${winningNumber}`);
    
  } catch (error) {
    console.error('Error closing slot:', error);
  }
};

// Process bet results and update wallets
const processBetResults = async (slotId, winningNumber) => {
  try {
    const bets = await prisma.matkaBet.findMany({
      where: { 
        matkaSlotId: slotId,
        status: 'pending'
      },
      include: { user: true, slot: true }
    });
    
    for (const bet of bets) {
      const won = bet.selectedNumber === winningNumber;
      const winAmount = won ? bet.stakeAmount * 10 : 0;
      
      await prisma.$transaction(async (tx) => {
        // Update bet status
        await tx.matkaBet.update({
          where: { id: bet.id },
          data: {
            status: won ? 'won' : 'lost',
            winAmount: winAmount
          }
        });
        
        // If won, add to wallet and create transaction
        if (won) {
          await tx.user.update({
            where: { id: bet.userId },
            data: { wallet: { increment: winAmount } }
          });
          
          await tx.transaction.create({
            data: {
              userId: bet.userId,
              amount: winAmount,
              type: 'matka_win',
              description: `Matka King Win - ${bet.slot.slotName} - Number: ${bet.selectedNumber}`
            }
          });
        }
      });
    }
    
  } catch (error) {
    console.error('Error processing bet results:', error);
  }
};

// Clean up old slots (keep only last 14 slots)
const cleanupOldSlots = async () => {
  try {
    // Keep last 21 slots (14 past + 7 current/future)
    const slotsToKeep = await prisma.matkaSlot.findMany({
      orderBy: { startTime: 'desc' },
      take: 21,
      select: { id: true }
    });
    
    const keepIds = slotsToKeep.map(slot => slot.id);
    
    // Delete older slots and their bets
    await prisma.matkaBet.deleteMany({
      where: {
        matkaSlotId: {
          notIn: keepIds
        }
      }
    });
    
    await prisma.matkaSlot.deleteMany({
      where: {
        id: {
          notIn: keepIds
        }
      }
    });
    
    console.log('🧹 Cleaned up old slots');
    
  } catch (error) {
    console.error('Error cleaning up old slots:', error);
  }
};

// API Endpoints

// Get all slots (last 21)
exports.getSlots = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Update statuses first
    await updateSlotStatuses();
    
    // Get last 21 slots with user bets
    const slots = await prisma.matkaSlot.findMany({
      include: {
        bets: {
          where: { userId },
          select: {
            id: true,
            selectedNumber: true,
            stakeAmount: true,
            winAmount: true,
            status: true
          }
        },
        _count: {
          select: { bets: true }
        }
      },
      orderBy: { startTime: 'desc' },
      take: 21
    });
    
    const formattedSlots = slots.map(slot => {
      const userBet = slot.bets[0] || null;
      
      return {
        id: slot.id,
        name: slot.slotName,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: slot.status,
        result: slot.result,
        participants: slot._count.bets,
        payout: 10,
        userBet: userBet ? {
          number: userBet.selectedNumber,
          amount: userBet.stakeAmount,
          winAmount: userBet.winAmount,
          status: userBet.status
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

// Place bet
exports.placeBet = async (req, res) => {
  try {
    const { slotId, number, amount } = req.body;
    const userId = req.user.id;
    
    // Validation
    const selectedNumber = parseInt(number);
    const betAmount = parseFloat(amount);
    
    if (isNaN(selectedNumber) || selectedNumber < 0 || selectedNumber > 9) {
      return res.status(400).json({ error: 'Number must be between 0-9' });
    }
    
    if (isNaN(betAmount) || betAmount < 10) {
      return res.status(400).json({ error: 'Minimum bet amount is ₹10' });
    }
    
    // Check slot exists and is open
    const slot = await prisma.matkaSlot.findUnique({
      where: { id: slotId }
    });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    const now = new Date();
    if (now < slot.startTime || now >= slot.endTime) {
      return res.status(400).json({ error: 'Slot is not open for betting' });
    }
    
    // Check for existing bet
    const existingBet = await prisma.matkaBet.findFirst({
      where: { userId, matkaSlotId: slotId }
    });
    
    if (existingBet) {
      return res.status(400).json({ error: 'You already have a bet in this slot' });
    }
    
    // Check user balance
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.wallet < betAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Place bet
    const result = await prisma.$transaction(async (tx) => {
      // Deduct from wallet
      await tx.user.update({
        where: { id: userId },
        data: { wallet: { decrement: betAmount } }
      });
      
      // Create transaction record
      await tx.transaction.create({
        data: {
          userId,
          amount: -betAmount,
          type: 'matka_bet',
          description: `Matka King Bet - ${slot.slotName} - Number: ${selectedNumber}`
        }
      });
      
      // Create bet
      const bet = await tx.matkaBet.create({
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
      newBalance: result.newBalance
    });
    
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get user sessions (betting history)
exports.getUserSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const bets = await prisma.matkaBet.findMany({
      where: { userId },
      include: { slot: true },
      orderBy: { createdAt: 'desc' },
      take: 50
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

// Cron jobs
// Generate slots daily at midnight
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Generating daily slots...');
  generateSlotsForDays(3);
});

// Update slot statuses every minute
cron.schedule('0 */2 * * *', () => {
  updateSlotStatuses();
});

// Cleanup old slots daily at 1 AM
cron.schedule('0 1 * * *', () => {
  console.log('🧹 Cleaning up old slots...');
  cleanupOldSlots();
});

// Initialize system
const initializeSystem = async () => {
  try {
    await generateSlotsForDays(3);
    await updateSlotStatuses();
    console.log('🚀 Matka King system initialized');
  } catch (error) {
    console.error('❌ Error initializing system:', error);
  }
};

// Auto-initialize on startup
setTimeout(initializeSystem, 1000);

module.exports = {
  getSlots: exports.getSlots,
  placeBet: exports.placeBet,
  getUserSessions: exports.getUserSessions
};