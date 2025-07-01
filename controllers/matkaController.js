const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cron = require('node-cron');
const moment = require('moment-timezone');

// Slot configurations
const SLOT_CONFIGS = [
  { start: '00:00', end: '06:00', name: '12:00 AM - 6:00 AM' },   // 6-hour slot
  { start: '06:00', end: '09:30', name: '6:00 AM - 9:30 AM' },   // 3.5 hours
  { start: '09:30', end: '13:00', name: '9:30 AM - 1:00 PM' },   // 3.5 hours
  { start: '13:00', end: '16:00', name: '1:00 PM - 4:00 PM' },   // 3 hours
  { start: '16:00', end: '19:00', name: '4:00 PM - 7:00 PM' },   // 3 hours
  { start: '19:00', end: '22:00', name: '7:00 PM - 10:00 PM' },  // 3 hours
  { start: '22:00', end: '00:00', name: '10:00 PM - 12:00 AM' }, // 2 hours
  { start: '08:00', end: '12:00', name: '8:00 AM - 12:00 PM' },  // 4 hours
  { start: '14:00', end: '18:00', name: '2:00 PM - 6:00 PM' },   // 4 hours
  { start: '20:00', end: '24:00', name: '8:00 PM - 12:00 AM' }   // 4 hours
];

// Generate secure random number
const secureRandom = (min, max) => {
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return min + (randomValue % (max - min + 1));
};

// Function to generate fake participants count based on slot status and time
const generateFakeParticipants = (slot, realParticipants) => {
  // For upcoming slots, return only real participants (should be 0 since disabled)
  if (slot.status === 'upcoming') {
    return realParticipants; // No fake participants for disabled slots
  }
  
  const now = moment().tz('Asia/Kolkata');
  const currentTime = now.format('HH:mm');
  
  let baseCount = 0;
  let multiplier = 1;
  
  // Different base counts based on slot status
  switch (slot.status) {
    case 'open':
      // This case is handled by getDynamicFakeParticipants
      baseCount = secureRandom(150, 250);
      multiplier = 1.0;
      break;
    case 'closed':
      // Closed slots show final count
      baseCount = secureRandom(200, 400);
      multiplier = 1.0;
      break;
    default:
      baseCount = secureRandom(20, 80);
  }
  
  // Add time-based variance (more participants during peak hours)
  const hour = parseInt(currentTime.split(':')[0]);
  let timeMultiplier = 1.0;
  
  // Peak hours: 9-12 AM, 2-6 PM, 8-11 PM
  if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18) || (hour >= 20 && hour <= 23)) {
    timeMultiplier = 1.2;
  }
  // Low hours: 12-6 AM
  else if (hour >= 0 && hour <= 6) {
    timeMultiplier = 0.8;
  }
  
  // Calculate fake count
  const fakeCount = Math.floor(baseCount * multiplier * timeMultiplier);
  
  // Always add real participants to fake count
  const totalParticipants = realParticipants + fakeCount;
  
  // Add some randomness to make it look more realistic
  const variance = secureRandom(-10, 15);
  
  return Math.max(totalParticipants + variance, realParticipants);
};

// Function to generate dynamic fake participants for open slots
const getDynamicFakeParticipants = (slot, realCount) => {
  const now = moment().tz('Asia/Kolkata');
  const currentTime = now.format('HH:mm');
  
  // Calculate how long the slot has been open
  const slotStartTime = moment(slot.startTime, 'HH:mm');
  const slotEndTime = moment(slot.endTime, 'HH:mm');
  
  // Handle slots that cross midnight
  if (slotEndTime.isBefore(slotStartTime)) {
    slotEndTime.add(1, 'day');
  }
  
  const currentMoment = moment(currentTime, 'HH:mm');
  if (currentMoment.isBefore(slotStartTime)) {
    currentMoment.add(1, 'day');
  }
  
  // Calculate progress through the slot (0 to 1)
  const totalDuration = slotEndTime.diff(slotStartTime, 'minutes');
  const elapsedTime = currentMoment.diff(slotStartTime, 'minutes');
  const progress = Math.max(0, Math.min(1, elapsedTime / totalDuration));
  
  // Gradual increase curve: starts at ~50, grows to 200-300, then plateaus
  let participantCount;
  
  if (progress <= 0.3) {
    // First 30% of slot duration: gradual increase from 50 to 120
    participantCount = 50 + (progress / 0.3) * 70;
  } else if (progress <= 0.7) {
    // Middle 40% of slot duration: steady increase from 120 to 250
    const midProgress = (progress - 0.3) / 0.4;
    participantCount = 120 + midProgress * 130;
  } else {
    // Last 30% of slot duration: plateau between 250-300 with small fluctuations
    const endProgress = (progress - 0.7) / 0.3;
    const baseCount = 250 + endProgress * 50;
    
    // Add small fluctuations during plateau phase
    const minute = now.minute();
    const fluctuation = Math.sin(minute / 5) * 10; // ±10 participants
    participantCount = baseCount + fluctuation;
  }
  
  // Add some randomness based on slot ID for consistency
  const slotSeed = parseInt(slot.slotId.replace(/\D/g, '') || '1');
  const randomVariance = (slotSeed % 20) - 10; // ±10 variance per slot
  
  // Peak time bonus (smaller bonus during plateau)
  const hour = now.hour();
  let peakBonus = 0;
  if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18) || (hour >= 20 && hour <= 23)) {
    peakBonus = progress <= 0.7 ? 30 : 10; // Less bonus during plateau
  }
  
  const finalCount = Math.floor(participantCount + randomVariance + peakBonus);
  
  // Ensure count is between 50-300 and add real participants
  const boundedFakeCount = Math.max(50, Math.min(300, finalCount));
  
  return realCount + boundedFakeCount;
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

          const winningNumber = Array.from({length: 10}, (_, i) => i)
            .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
            .find(number => (stakes.get(number) || 0) * 10 <= totalBet);

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
      const winAmount = won ? bet.stakeAmount * 10 : 0;
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

// Get all available slots WITH FAKE PARTICIPANTS
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
    
    // Format response data with fake participants
    const formattedSlots = slots.map(slot => {
      const userBet = slot.bets.length > 0 ? slot.bets[0] : null;
      const realParticipants = slot._count.bets;
      
      // Generate participants based on slot status
      let totalParticipants;
      if (slot.status === 'upcoming') {
        // Upcoming slots show only real participants (should be 0 since disabled)
        totalParticipants = realParticipants;
      } else if (slot.status === 'open') {
        // For open slots, use dynamic fake participants with gradual increase
        totalParticipants = getDynamicFakeParticipants(slot, realParticipants);
      } else {
        // For closed slots, use static fake participants
        totalParticipants = generateFakeParticipants(slot, realParticipants);
      }
      
      // Convert time strings to decimal for frontend compatibility
      const startTimeDecimal = timeStringToDecimal(slot.startTime);
      const endTimeDecimal = timeStringToDecimal(slot.endTime);
      
      return {
        id: slot.id,
        name: slot.slotName,
        status: slot.status,
        participants: totalParticipants,
        winningNumber: slot.result,
        payout: 10,
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