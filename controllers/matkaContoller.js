const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cron = require('node-cron');
const moment = require('moment-timezone');

// Predefined game slots
const GAME_SLOTS = [
  { id: 'morning', name: 'Morning', start: '09:00', end: '12:00' },
  { id: 'afternoon', name: 'Afternoon', start: '13:00', end: '15:00' },
  { id: 'evening', name: 'Evening', start: '16:00', end: '19:00' },
  { id: 'night', name: 'Night', start: '20:00', end: '23:00' }
];

// Check if tables exist
const checkTablesExist = async () => {
  try {
    // Check if matka_slots table exists
    await prisma.$queryRaw`SELECT 1 FROM "matka_slots" LIMIT 1`;
    return true;
  } catch (error) {
    console.error('Matka tables not found. Please run database migrations.');
    return false;
  }
};

// Initialize daily slots
const initializeDailySlots = async () => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const slot of GAME_SLOTS) {
      const existing = await prisma.matkaSlot.findFirst({
        where: {
          slotDate: today,
          slotId: slot.id
        }
      });
      
      if (!existing) {
        await prisma.matkaSlot.create({
          data: {
            slotId: slot.id,
            slotName: slot.name,
            slotDate: today,
            startTime: slot.start,
            endTime: slot.end,
            status: 'scheduled'
          }
        });
      }
    }
  } catch (error) {
    console.error('Error initializing slots:', error);
  }
};

// Start cron job to initialize slots daily at 00:05 AM
cron.schedule('5 0 * * *', () => {
  console.log('Initializing daily slots...');
  initializeDailySlots();
});

// Start cron job to close slots and draw results
cron.schedule('* * * * *', async () => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) return;

    const now = moment().tz('Asia/Kolkata');
    const currentTime = now.format('HH:mm');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Close slots that have passed their end time
    const slotsToClose = await prisma.matkaSlot.findMany({
      where: {
        slotDate: today,
        status: 'open',
        endTime: { lt: currentTime }
      }
    });
    
    for (const slot of slotsToClose) {
      await prisma.matkaSlot.update({
        where: { id: slot.id },
        data: { status: 'closed' }
      });
      console.log(`Closed slot: ${slot.slotName} (${slot.slotDate.toISOString().split('T')[0]})`);
    }
    
    // Draw results for closed slots without results
    const slotsToDraw = await prisma.matkaSlot.findMany({
      where: {
        slotDate: today,
        status: 'closed',
        result: null
      },
      include: {
        bets: true
      }
    });
    
    for (const slot of slotsToDraw) {
      await drawMatkaSlot(slot);
    }
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

// Draw result for a slot and settle bets
const drawMatkaSlot = async (slot) => {
  try {
    const result = Math.floor(Math.random() * 10); // 0-9
    const payoutMultiplier = 9; // 9x payout for winners
    
    // Update slot with result
    await prisma.matkaSlot.update({
      where: { id: slot.id },
      data: { result, status: 'completed' }
    });
    
    // Process bets
    for (const bet of slot.bets) {
      if (bet.selectedNumber === result) {
        // Winner - credit winnings
        const winAmount = bet.stakeAmount * payoutMultiplier;
        
        await prisma.$transaction([
          prisma.user.update({
            where: { id: bet.userId },
            data: { wallet: { increment: winAmount } }
          }),
          prisma.matkaBet.update({
            where: { id: bet.id },
            data: { status: 'won', winAmount }
          }),
          prisma.transaction.create({
            data: {
              userId: bet.userId,
              amount: winAmount,
              type: 'matka_win',
              description: `Matka Win - ${slot.slotName} Slot (${slot.slotDate.toISOString().split('T')[0]}) - Number: ${bet.selectedNumber}`
            }
          })
        ]);
      } else {
        // Loser - mark bet as lost
        await prisma.matkaBet.update({
          where: { id: bet.id },
          data: { status: 'lost' }
        });
      }
    }
    
    console.log(`Drawn result for ${slot.slotName} slot (${slot.slotDate.toISOString().split('T')[0]}): ${result}`);
  } catch (error) {
    console.error('Error drawing slot results:', error);
  }
};

// Open scheduled slots
const openScheduledSlots = async () => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) return 0;

    const now = moment().tz('Asia/Kolkata');
    const currentTime = now.format('HH:mm');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const slotsToOpen = await prisma.matkaSlot.findMany({
      where: {
        slotDate: today,
        status: 'scheduled',
        startTime: { lte: currentTime }
      }
    });
    
    for (const slot of slotsToOpen) {
      await prisma.matkaSlot.update({
        where: { id: slot.id },
        data: { status: 'open' }
      });
      console.log(`Opened slot: ${slot.slotName} (${slot.slotDate.toISOString().split('T')[0]})`);
    }
    
    return slotsToOpen.length;
  } catch (error) {
    console.error('Error opening slots:', error);
    return 0;
  }
};

// Add cron job to open scheduled slots every minute
cron.schedule('* * * * *', () => {
  openScheduledSlots();
});

// Get available slots
exports.getSlots = async (req, res) => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) {
      return res.status(500).json({ error: 'Matka system not initialized. Please run database migrations.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentTime = moment().tz('Asia/Kolkata').format('HH:mm');
    
    // Initialize slots if not already created
    await initializeDailySlots();
    
    const slots = await prisma.matkaSlot.findMany({
      where: { slotDate: today },
      orderBy: { startTime: 'asc' }
    });
    
    // Add status and time info
    const processedSlots = slots.map(slot => {
      const isOpen = slot.status === 'open';
      const slotEnd = moment(slot.endTime, 'HH:mm');
      const current = moment(currentTime, 'HH:mm');
      
      return {
        id: slot.id,
        slotId: slot.slotId,
        name: slot.slotName,
        date: slot.slotDate.toISOString().split('T')[0],
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: slot.status,
        result: slot.result,
        isActive: isOpen,
        canBet: isOpen && current.isBefore(slotEnd),
        timeLeft: isOpen ? slotEnd.diff(current) : 0
      };
    });
    
    res.json({ success: true, slots: processedSlots });
  } catch (error) {
    console.error('Error getting slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Place a bet
exports.placeBet = async (req, res) => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) {
      return res.status(500).json({ error: 'Matka system not initialized. Please run database migrations.' });
    }

    const { slotId, number, amount } = req.body;
    const userId = req.user.id;
    
    // Validate input
    if (!slotId || number === undefined || !amount) {
      return res.status(400).json({ error: 'Slot ID, number, and amount are required' });
    }
    
    const selectedNumber = parseInt(number);
    const stakeAmount = parseFloat(amount);
    
    if (isNaN(selectedNumber)) {
      return res.status(400).json({ error: 'Invalid number format' });
    }
    
    if (selectedNumber < 0 || selectedNumber > 9) {
      return res.status(400).json({ error: 'Number must be between 0-9' });
    }
    
    if (isNaN(stakeAmount)) {
      return res.status(400).json({ error: 'Invalid amount format' });
    }
    
    if (stakeAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }
    
    // Get slot
    const slot = await prisma.matkaSlot.findUnique({
      where: { id: slotId }
    });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    // Check slot status
    const now = moment().tz('Asia/Kolkata');
    const currentTime = now.format('HH:mm');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const slotDateStr = slot.slotDate.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];
    
    if (slotDateStr !== todayStr) {
      return res.status(400).json({ error: 'Slot is not for today' });
    }
    
    if (slot.status !== 'open') {
      return res.status(400).json({ error: 'Slot is not open for betting' });
    }
    
    const slotEnd = moment(slot.endTime, 'HH:mm');
    const current = moment(currentTime, 'HH:mm');
    
    if (current.isSameOrAfter(slotEnd)) {
      return res.status(400).json({ error: 'Slot betting has closed' });
    }
    
    // Check user balance
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (user.wallet < stakeAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Place bet
    const result = await prisma.$transaction([
      // Deduct stake from user wallet
      prisma.user.update({
        where: { id: userId },
        data: { wallet: { decrement: stakeAmount } }
      }),
      
      // Record transaction
      prisma.transaction.create({
        data: {
          userId,
          amount: -stakeAmount,
          type: 'matka_bet',
          description: `Matka Bet - ${slot.slotName} Slot - Number: ${selectedNumber}`
        }
      }),
      
      // Create bet
      prisma.matkaBet.create({
        data: {
          userId,
          matkaSlotId: slotId,
          selectedNumber,
          stakeAmount,
          status: 'pending'
        }
      })
    ]);
    
    const bet = result[2];
    
    res.json({
      success: true,
      message: 'Bet placed successfully',
      betId: bet.id,
      newBalance: user.wallet - stakeAmount
    });
    
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get user bets
exports.getUserBets = async (req, res) => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) {
      return res.status(500).json({ error: 'Matka system not initialized. Please run database migrations.' });
    }

    const userId = req.user.id;
    const { date } = req.query;
    
    const whereCondition = {
      userId
    };
    
    if (date) {
      const filterDate = new Date(date);
      filterDate.setHours(0, 0, 0, 0);
      
      whereCondition.slot = {
        slotDate: filterDate
      };
    }
    
    const bets = await prisma.matkaBet.findMany({
      where: whereCondition,
      include: {
        slot: {
          select: {
            slotName: true,
            slotDate: true,
            result: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    const processedBets = bets.map(bet => ({
      id: bet.id,
      selectedNumber: bet.selectedNumber,
      stakeAmount: bet.stakeAmount,
      winAmount: bet.winAmount,
      status: bet.status,
      slot: bet.slot.slotName,
      date: bet.slot.slotDate.toISOString().split('T')[0],
      result: bet.slot.result,
      createdAt: bet.createdAt
    }));
    
    res.json({ success: true, bets: processedBets });
  } catch (error) {
    console.error('Error getting user bets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get slot details
exports.getSlotDetails = async (req, res) => {
  try {
    const tablesExist = await checkTablesExist();
    if (!tablesExist) {
      return res.status(500).json({ error: 'Matka system not initialized. Please run database migrations.' });
    }

    const { slotId } = req.params;
    const userId = req.user.id;
    
    const slot = await prisma.matkaSlot.findUnique({
      where: { id: slotId },
      include: {
        bets: {
          where: { userId },
          take: 1
        }
      }
    });
    
    if (!slot) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    const userBet = slot.bets.length > 0 ? slot.bets[0] : null;
    
    res.json({
      success: true,
      slot: {
        id: slot.id,
        name: slot.slotName,
        date: slot.slotDate.toISOString().split('T')[0],
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: slot.status,
        result: slot.result,
        userBet: userBet ? {
          selectedNumber: userBet.selectedNumber,
          stakeAmount: userBet.stakeAmount,
          status: userBet.status,
          winAmount: userBet.winAmount
        } : null
      }
    });
  } catch (error) {
    console.error('Error getting slot details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Initialize slots on server start
checkTablesExist().then(tablesExist => {
  if (tablesExist) {
    initializeDailySlots().then(() => {
      console.log('Initialized daily slots');
    }).catch(err => {
      console.error('Failed to initialize daily slots:', err);
    });
  } else {
    console.error('Matka tables not found. Skipping slot initialization.');
  }
});