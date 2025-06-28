const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const otpGenerator = require('otp-generator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY; // Replace with your actual API key

const otpStore = {};

const generateReferralCode = async () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = '';
    for (let i = 0; i < 8; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    const existingUser = await prisma.user.findFirst({
      where: { referralCode: code },
    });

    if (!existingUser) isUnique = true;
  }

  return code;
};

// Function to send OTP via Fast2SMS
const sendOTP = async (phoneNumber, otp) => {
  try {
    const response = await axios.post('https://www.fast2sms.com/dev/bulkV2', {
      route: 'otp',
      variables_values: otp,
      schedule_time: '',
      numbers: phoneNumber
    }, {
      headers: {
        'Authorization': FAST2SMS_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Fast2SMS Error:', error.response?.data || error.message);
    throw new Error('Failed to send OTP');
  }
};

// Signup controller
const signup = async (req, res) => {
  try {
    const { phoneNumber, password, referralCode } = req.body;

    // Validate phone number format (basic validation)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneNumber || !phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ error: 'Valid phone number is required (10 digits starting with 6-9)' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Check if phone number already exists
    const existingUser = await prisma.user.findUnique({ where: { phoneNumber } });
    if (existingUser) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate 6-digit OTP
    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    // Store OTP temporarily
    otpStore[phoneNumber] = {
      otp,
      expiresAt: Date.now() + 300000, // 5 minutes
      password: hashedPassword,
      referralCode
    };

    // Send OTP via Fast2SMS
    await sendOTP(phoneNumber, otp);

    return res.status(200).json({
      message: 'OTP sent successfully to your phone number.',
      expiresIn: 300
    });

  } catch (error) {
    console.error('Error in signup:', error);
    return res.status(500).json({ error: 'Failed to process signup' });
  }
};

// Verify OTP controller
const verifyOtp = async (req, res) => {
  const { phoneNumber, otp } = req.body;

  if (!phoneNumber || !otp) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  const storedData = otpStore[phoneNumber];

  if (!storedData || Date.now() > storedData.expiresAt) {
    delete otpStore[phoneNumber];
    return res.status(400).json({ error: 'OTP expired or not found' });
  }

  if (storedData.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  try {
    const referralCode = await generateReferralCode();

    const user = await prisma.user.create({
      data: {
        phoneNumber,
        password: storedData.password,
        wallet: 0,
        referralCode
      }
    });

    // Handle referral bonus if referral code was provided
    if (storedData.referralCode) {
      const referrer = await prisma.user.findFirst({
        where: { referralCode: storedData.referralCode }
      });

      if (referrer && referrer.id !== user.id) {
        await prisma.referral.create({
          data: {
            referrer: { connect: { id: referrer.id } },
            referee: { connect: { id: user.id } }
          }
        });

        const bonusAmount = 10;

        // Update wallet balances
        await prisma.user.update({
          where: { id: referrer.id },
          data: { wallet: { increment: bonusAmount } }
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { wallet: { increment: bonusAmount } }
        });

        // Create transaction records
        await prisma.transaction.createMany({
          data: [
            {
              userId: referrer.id,
              amount: bonusAmount,
              type: 'referral_bonus'
            },
            {
              userId: user.id,
              amount: bonusAmount,
              type: 'referral_bonus'
            }
          ]
        });
      }
    }

    // Clean up OTP store
    delete otpStore[phoneNumber];

    // Generate JWT token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Account created successfully',
      token
    });

  } catch (error) {
    console.error('Error in verifyOtp:', error);
    return res.status(500).json({ error: 'Failed to create account' });
  }
};

// Login controller
const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(200).json({
      message: 'Login successful',
      token
    });

  } catch (error) {
    console.error('Error in login:', error);
    return res.status(500).json({ error: 'Failed to process login' });
  }
};

// Resend OTP controller (optional but useful)
const resendOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const storedData = otpStore[phoneNumber];
    if (!storedData) {
      return res.status(400).json({ error: 'No pending OTP request found' });
    }

    // Generate new OTP
    const newOtp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    // Update stored data with new OTP and extended expiry
    otpStore[phoneNumber] = {
      ...storedData,
      otp: newOtp,
      expiresAt: Date.now() + 300000 // 5 minutes
    };

    // Send new OTP
    await sendOTP(phoneNumber, newOtp);

    return res.status(200).json({
      message: 'OTP resent successfully',
      expiresIn: 300
    });

  } catch (error) {
    console.error('Error in resendOtp:', error);
    return res.status(500).json({ error: 'Failed to resend OTP' });
  }
};

// Get user data
const getUserData = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    // console.log("Decoded user:", decoded);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        phoneNumber: true,
        wallet: true,
        referralCode: true,
      }
    });
    // console.log(user);

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user);
  } catch (error) {
    console.error("Token validation error:", error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get user data
// Controller to fetch data from two unrelated tables and combine them
exports.getGameHistory = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    // Query 1: Fetch from gameSession table
    const gameSessions = await prisma.gameSession.findMany({
      where: { 
        userId: userId,
        status: 'completed' // Only completed games
      },
      select: {
        id: true,
        gameId: true,
        userId: true,
        gameType: true,
        stake: true,
        winAmount: true,
        result: true,
        completedAt: true,
        createdAt: true,
        luckyNumber: true,
        rollHistory: true,
      },
      orderBy: {
        completedAt: 'desc'
      }
    });

    // Query 2: Fetch from matkaBet table  
    const matkaBets = await prisma.matkaBet.findMany({
      where: { userId: userId },
      select: {
        id: true,
        userId: true,
        stakeAmount: true,
        winAmount: true,
        status: true,
        selectedNumber: true,
        createdAt: true,
        matkaSlotId: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Optional: If you want slot details for matka bets
    const matkaSlotIds = matkaBets.map(bet => bet.matkaSlotId).filter(Boolean);
    let slotDetails = {};
    
    if (matkaSlotIds.length > 0) {
      const slots = await prisma.matkaSlot.findMany({
        where: { id: { in: matkaSlotIds } },
        select: {
          id: true,
          slotName: true,
          result: true,
          slotDate: true
        }
      });
      
      // Create lookup object for slot details
      slotDetails = slots.reduce((acc, slot) => {
        acc[slot.id] = slot;
        return acc;
      }, {});
    }

    // Transform gameSession data to unified format
    const transformedGameSessions = gameSessions.map(game => ({
      id: game.id,
      gameId: game.gameId,
      type: 'game_session',
      gameType: game.gameType,
      stake: game.stake,
      winAmount: game.winAmount || 0,
      result: game.result, // 'win' or 'loss'
      won: game.result === 'win',
      date: game.completedAt || game.createdAt,
      luckyNumber: game.luckyNumber,
      rollHistory: game.rollHistory,
      // Add any other game-specific fields
      opponent: null, // Add if you have opponent data
    }));

    // Transform matkaBet data to unified format
    const transformedMatkaBets = matkaBets.map(bet => ({
      id: bet.id,
      gameId: `matka_${bet.id}`,
      type: 'matka_bet',
      gameType: 'matka',
      stake: bet.stakeAmount,
      winAmount: bet.winAmount || 0,
      result: bet.status === 'won' ? 'win' : 'loss',
      won: bet.status === 'won',
      date: bet.createdAt,
      selectedNumber: bet.selectedNumber,
      // Add slot information if available
      slotInfo: slotDetails[bet.matkaSlotId] || null,
    }));

    // Combine both arrays
    const allGames = [...transformedGameSessions, ...transformedMatkaBets];

    // Sort combined results by date (newest first)
    allGames.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Calculate summary statistics
    const totalGames = allGames.length;
    const gamesWon = allGames.filter(game => game.won).length;
    const gamesLost = totalGames - gamesWon;
    const totalWinnings = allGames.reduce((sum, game) => {
      return sum + (game.won ? game.winAmount : -game.stake);
    }, 0);

    // Send unified response
    res.json({
      success: true,
      games: allGames,
      summary: {
        totalGames,
        gamesWon,
        gamesLost,
        totalWinnings,
        winRate: totalGames > 0 ? ((gamesWon / totalGames) * 100).toFixed(1) : 0
      }
    });

  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// Raw SQL approach (if you prefer SQL)
const gamesHistory = async (req, res) => {
   try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    // Safer approach: Use separate Prisma queries
    const [gameSessions, matkaBets] = await Promise.all([
      prisma.gameSession.findMany({
        where: { userId: userId },
        select: {
          id: true,
          gameType: true,
          stake: true,
          winAmount: true,
          result: true,
          createdAt: true,
          gameId: true,
          luckyNumber: true,
          rollHistory: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20 // Limit to 20 records
      }),
      
      prisma.matkaBet.findMany({
        where: { userId: userId },
        select: {
          id: true,
          stakeAmount: true,
          winAmount: true,
          status: true,
          createdAt: true,
          selectedNumber: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20 // Limit to 20 records
      })
    ]);

    // Transform and combine
    const allGames = [
      ...gameSessions.map(game => ({
        id: game.id,
        sourceTable: 'gameSession',
        gameType: game.gameType,
        stake: game.stake,
        winAmount: game.winAmount || 0,
        result: game.result,
        won: game.result === 'win',
        date: game.createdAt,
        gameId: game.gameId,
        luckyNumber: game.luckyNumber,
        rollHistory: game.rollHistory
      })),
      ...matkaBets.map(bet => ({
        id: bet.id,
        sourceTable: 'matkaBet',
        gameType: 'matka',
        stake: bet.stakeAmount,
        winAmount: bet.winAmount || 0,
        result: bet.status,
        won: bet.status === 'won',
        date: bet.createdAt,
        selectedNumber: bet.selectedNumber
      }))
    ];

    // Sort combined results by date and take only 20 most recent
    allGames.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentGames = allGames.slice(0, 20);

    res.json({
      success: true,
      games: recentGames,
      total: recentGames.length
    });

  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

module.exports = {
  signup,
  verifyOtp,
  login,
  getUserData,
  resendOtp,
  gamesHistory
};