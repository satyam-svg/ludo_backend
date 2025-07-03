const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cron = require('node-cron');
const moment = require('moment-timezone');

// Slot configurations
const SLOT_CONFIGS = [
  { start: '00:00', end: '06:00', name: '12:00 AM - 6:00 AM' },
  { start: '06:00', end: '09:30', name: '6:00 AM - 9:30 AM' },
  { start: '09:30', end: '13:00', name: '9:30 AM - 1:00 PM' },
  { start: '13:00', end: '16:00', name: '1:00 PM - 4:00 PM' },
  { start: '16:00', end: '19:00', name: '4:00 PM - 7:00 PM' },
  { start: '19:00', end: '22:00', name: '7:00 PM - 10:00 PM' },
  { start: '22:00', end: '00:00', name: '10:00 PM - 12:00 AM'}
];

// In-memory storage for fake participant counts (Max 14 entries, 48h retention)
const fakeParticipantsCache = new Map();

// Generate secure random number
const secureRandom = (min, max) => {
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return min + (randomValue % (max - min + 1));
};

// Generate cache key for slot
const getSlotCacheKey = (slotId, date = null) => {
  const targetDate = date || new Date().toISOString().split('T')[0];
  return `${slotId}_${targetDate}`;
};

// Clean up cache entries older than 72 hours (to accommodate 24h result viewing)
const cleanupFakeParticipantsCache = () => {
  const now = new Date();
  const seventyTwoHoursAgo = new Date(now.getTime() - (72 * 60 * 60 * 1000)); // 72 hours for safety
  const keysToDelete = [];
  
  for (const [key, data] of fakeParticipantsCache.entries()) {
    const [slotId, dateStr] = key.split('_');
    const entryDate = new Date(dateStr + 'T00:00:00Z');
    
    if (entryDate < seventyTwoHoursAgo) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => fakeParticipantsCache.delete(key));
};

// Function to calculate fake participants for OPEN slots
const calculateFakeParticipants = (slot, realCount) => {
  const now = moment().tz('Asia/Kolkata');
  const currentTime = now.format('HH:mm');
  
  const slotStartTime = moment(slot.startTime, 'HH:mm');
  const slotEndTime = moment(slot.endTime, 'HH:mm');
  
  if (slotEndTime.isBefore(slotStartTime)) {
    slotEndTime.add(1, 'day');
  }
  
  const currentMoment = moment(currentTime, 'HH:mm');
  if (currentMoment.isBefore(slotStartTime)) {
    currentMoment.add(1, 'day');
  }
  
  const elapsedMinutes = Math.max(0, currentMoment.diff(slotStartTime, 'minutes'));
  
  let fakeParticipants = 0;
  
  if (elapsedMinutes < 5) {
    fakeParticipants = 0;
  } else if (elapsedMinutes < 10) {
    fakeParticipants = secureRandom(5, 8);
  } else if (elapsedMinutes < 20) {
    const intervals = Math.floor((elapsedMinutes - 10) / 2);
    fakeParticipants = 8 + (intervals * secureRandom(3, 5));
  } else if (elapsedMinutes < 40) {
    const baseCount = 8 + Math.floor(10 / 2) * 4;
    const intervals = Math.floor((elapsedMinutes - 20) / 3);
    fakeParticipants = Math.floor(baseCount + (intervals * secureRandom(4, 7)));
  } else if (elapsedMinutes < 60) {
    const baseCount = 70;
    const intervals = Math.floor((elapsedMinutes - 40) / 4);
    fakeParticipants = baseCount + (intervals * secureRandom(3, 5));
  } else if (elapsedMinutes < 90) {
    const baseCount = 110;
    const intervals = Math.floor((elapsedMinutes - 60) / 5);
    fakeParticipants = baseCount + (intervals * secureRandom(2, 4));
  } else {
    const baseCount = secureRandom(150, 200);
    const occasionalAdd = Math.floor((elapsedMinutes - 90) / 10) * secureRandom(0, 2);
    fakeParticipants = baseCount + occasionalAdd;
  }
  
  const slotSeed = parseInt(slot.slotId.replace(/\D/g, '') || '1');
  const slotVariance = (slotSeed % 20) - 10;
  
  const hour = now.hour();
  let peakBonus = 0;
  if (elapsedMinutes >= 20 && ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18) || (hour >= 20 && hour <= 23))) {
    if (elapsedMinutes >= 60) {
      peakBonus = secureRandom(30, 50);
    } else if (elapsedMinutes >= 40) {
      peakBonus = secureRandom(20, 35);
    } else {
      peakBonus = secureRandom(10, 20);
    }
  }
  
  const finalFakeCount = Math.max(0, fakeParticipants + slotVariance + peakBonus);
  
  let cappedFakeCount;
  if (elapsedMinutes >= 60) {
    cappedFakeCount = Math.max(150, Math.min(300, finalFakeCount));
  } else {
    cappedFakeCount = Math.min(finalFakeCount, 300);
  }
  
  return cappedFakeCount;
};

// Get participants count with caching logic
const getParticipantsCount = (slot, realCount) => {
  const cacheKey = getSlotCacheKey(slot.slotId);
  const cached = fakeParticipantsCache.get(cacheKey);
  
  if (slot.status === 'open') {
    const fakeCount = calculateFakeParticipants(slot, realCount);
    const totalCount = realCount + fakeCount;
    
    fakeParticipantsCache.set(cacheKey, {
      fakeCount: fakeCount,
      finalCount: totalCount,
      status: 'open',
      lastUpdated: Date.now()
    });
    
    return totalCount;
    
  } else if (slot.status === 'closed' && cached) {
    fakeParticipantsCache.set(cacheKey, {
      ...cached,
      status: 'closed',
      lastUpdated: Date.now()
    });
    
    return cached.finalCount;
    
  } else if (slot.status === 'closed' && !cached) {
    const estimatedFinalCount = realCount + secureRandom(150, 300);
    
    fakeParticipantsCache.set(cacheKey, {
      fakeCount: estimatedFinalCount - realCount,
      finalCount: estimatedFinalCount,
      status: 'closed',
      lastUpdated: Date.now()
    });
    
    return estimatedFinalCount;
    
  } else {
    return realCount;
  }
};

// Initialize daily slots in database
const initializeDailySlots = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < SLOT_CONFIGS.length; i++) {
      const config = SLOT_CONFIGS[i];
      const slotId = `slot_${i}`;
      
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
      }
    }
    
    cleanupFakeParticipantsCache();
    
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
    
    // Only update today's slots - yesterday's slots should remain closed
    const slots = await prisma.matkaSlot.findMany({
      where: {
        slotDate: today // Only today's slots
      }
    });
    
    for (const slot of slots) {
      let newStatus = slot.status;
      
      // Special handling for the midnight crossing slot (22:00-00:00)
      if (slot.startTime === '22:00' && slot.endTime === '00:00') {
        if (currentTime >= '22:00' || currentTime < '00:00') {
          // Between 22:00-23:59 - slot is OPEN
          newStatus = 'open';
        } else if (currentTime >= '00:00' && currentTime < '22:00') {
          // Between 00:00-21:59 
          if (currentTime >= '00:00' && currentTime < '06:00') {
            // Between 00:00-05:59 - slot is CLOSED (just closed)
            newStatus = 'closed';
            
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
              
              await processSlotResults(slot.id, winningNumber);
              continue;
            }
          } else {
            // Between 06:00-21:59 - slot is UPCOMING (for next day)
            newStatus = 'upcoming';
          }
        }
      } else {
        // For all other normal slots that don't cross midnight
        if (currentTime >= slot.startTime && currentTime < slot.endTime) {
          newStatus = 'open';
        } else if (currentTime >= slot.endTime) {
          newStatus = 'closed';
          
          if (slot.status !== 'closed' && slot.result === null) {
            const allBets = await prisma.matkaBet.findMany({
            where: { matkaSlotId: slot.id },
            select: { stakeAmount: true, selectedNumber: true }
          });

          const stakes = new Map();
          const counts = new Map();
          let totalBet = 0;

          // Initialize and calculate
          for (let i = 0; i <= 9; i++) {
            stakes.set(i, 0);
            counts.set(i, 0);
          }

          for (const { stakeAmount, selectedNumber } of allBets) {
            totalBet += stakeAmount;
            stakes.set(selectedNumber, stakes.get(selectedNumber) + stakeAmount);
            counts.set(selectedNumber, counts.get(selectedNumber) + 1);
          }

          // Sort numbers by frequency (desc), then by stake (asc)
          const sortedNumbers = Array.from({length: 10}, (_, i) => i)
            .sort((a, b) => counts.get(b) - counts.get(a) || stakes.get(a) - stakes.get(b));

          // Find winning number
          let winningNumber = null;
          for (const num of sortedNumbers) {
            if (stakes.get(num) * 10 <= totalBet) {
              // Get all numbers with same frequency that are affordable
              const sameFrequency = sortedNumbers.filter(n => 
                counts.get(n) === counts.get(num) && stakes.get(n) * 10 <= totalBet
              );
              winningNumber = sameFrequency[Math.floor(Math.random() * sameFrequency.length)];
              break;
            }
          }
            
            await processSlotResults(slot.id, winningNumber);
            continue;
          }
        } else {
          newStatus = 'upcoming';
        }
      }
      
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
    
    for (const bet of bets) {
      const won = bet.selectedNumber === winningNumber;
      const winAmount = won ? bet.stakeAmount * 10 : 0;
      
      await prisma.$transaction(async (prisma) => {
        await prisma.matkaBet.update({
          where: { id: bet.id },
          data: {
            status: won ? 'won' : 'lost',
            winAmount: winAmount
          }
        });
        
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
        }
      });
    }
  } catch (error) {
    console.error('Error processing slot results:', error);
  }
};

// Get all available slots (current day + previous day if within 24h)
exports.getSlots = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    await initializeDailySlots();
    await updateSlotStatuses();
    
    // Get slots from today AND yesterday
    const slots = await prisma.matkaSlot.findMany({
      where: {
        slotDate: {
          in: [yesterday, today]
        }
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
      orderBy: [
        { slotDate: 'desc' }, // Most recent date first
        { startTime: 'asc' }  // Then by start time
      ]
    });
    
    const now = moment().tz('Asia/Kolkata');
    
    const formattedSlots = slots.map(slot => {
      const userBet = slot.bets.length > 0 ? slot.bets[0] : null;
      const realParticipants = slot._count.bets;
      
      // Determine if this slot is from today or yesterday
      const slotDate = moment(slot.slotDate);
      const isToday = slotDate.isSame(now, 'day');
      const isYesterday = slotDate.isSame(moment().subtract(1, 'day'), 'day');
      
      let displayStatus = slot.status;
      let totalParticipants = realParticipants;
      
      if (isToday) {
        // Today's slots: normal logic
        totalParticipants = getParticipantsCount(slot, realParticipants);
        displayStatus = slot.status;
      } else if (isYesterday) {
        // Yesterday's slots: check if within 24 hours of closing
        const slotEndTime = moment(slot.endTime, 'HH:mm');
        let slotCloseDateTime = moment(slot.slotDate).add(slotEndTime.hours(), 'hours').add(slotEndTime.minutes(), 'minutes');
        
        // Handle midnight crossover slots (like 22:00-00:00)
        if (slot.endTime < slot.startTime) {
          slotCloseDateTime.add(1, 'day'); // Add 1 day for slots ending next day
        }
        
        const hoursSinceClosed = now.diff(slotCloseDateTime, 'hours');
        
        if (hoursSinceClosed <= 24) {
          // Within 24 hours: show as closed with cached participants
          totalParticipants = getParticipantsCount(slot, realParticipants);
          displayStatus = 'closed';
        } else {
          // More than 24 hours: don't include this slot
          return null;
        }
      } else {
        // Older than yesterday: don't include
        return null;
      }
      
      const startTimeDecimal = timeStringToDecimal(slot.startTime);
      const endTimeDecimal = timeStringToDecimal(slot.endTime);
      
      return {
        id: slot.id,
        name: slot.slotName,
        status: displayStatus,
        participants: totalParticipants,
        winningNumber: displayStatus === 'closed' ? slot.result : null,
        payout: 10,
        startTime: startTimeDecimal,
        endTime: endTimeDecimal,
        slotDate: slot.slotDate.toISOString().split('T')[0], // Add date for frontend
        isToday: isToday,
        userBet: userBet ? {
          number: userBet.selectedNumber,
          amount: userBet.stakeAmount,
          gameId: userBet.id,
          status: userBet.status,
          winAmount: userBet.winAmount
        } : null
      };
    }).filter(slot => slot !== null); // Remove null entries
    
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
    
    const slot = await prisma.matkaSlot.findUnique({
      where: { id: slotId }
    });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    await updateSlotStatuses();
    
    const updatedSlot = await prisma.matkaSlot.findUnique({
      where: { id: slotId }
    });
    
    if (updatedSlot.status !== 'open') {
      return res.status(400).json({ error: 'Slot is not open for betting' });
    }
    
    const existingBet = await prisma.matkaBet.findFirst({
      where: {
        userId: userId,
        matkaSlotId: slotId
      }
    });
    
    if (existingBet) {
      return res.status(400).json({ error: 'You already have a bet in this slot' });
    }
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.wallet < betAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const result = await prisma.$transaction(async (prisma) => {
      await prisma.user.update({
        where: { id: userId },
        data: { wallet: { decrement: betAmount } }
      });
      
      await prisma.transaction.create({
        data: {
          userId,
          amount: -betAmount,
          type: 'matka_bet',
          description: `Matka King Bet - ${slot.slotName} - Number: ${selectedNumber}, Amount: ₹${betAmount}`
        }
      });
      
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

// Get user's game sessions
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

// Initialize system
const initializeSystem = async () => {
  try {
    await initializeDailySlots();
  } catch (error) {
    console.error('Error initializing Matka King system:', error);
  }
};

// Cron jobs
cron.schedule('0 0 * * *', () => {
  initializeDailySlots();
});

cron.schedule('* * * * *', () => {
  updateSlotStatuses();
});

cron.schedule('0 */6 * * *', () => {
  const now = new Date();
  const seventyTwoHoursAgo = new Date(now.getTime() - (72 * 60 * 60 * 1000));
  const keysToDelete = [];
  
  for (const [key, data] of fakeParticipantsCache.entries()) {
    const [slotId, dateStr] = key.split('_');
    const entryDate = new Date(dateStr + 'T00:00:00Z');
    
    if (entryDate < seventyTwoHoursAgo) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => fakeParticipantsCache.delete(key));
});

initializeSystem();

module.exports = {
  getSlots: exports.getSlots,
  placeBet: exports.placeBet,
  getUserSessions: exports.getUserSessions,
  getGameSession: exports.getGameSession
};