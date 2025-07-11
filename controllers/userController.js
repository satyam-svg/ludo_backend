const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const otpGenerator = require('otp-generator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;

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

// Process referral bonus when referred user makes first deposit
const processReferralBonus = async (userId, depositAmount) => {
  try {
    // Check if this user was referred
    const referralRecord = await prisma.referral.findUnique({
      where: { refereeId: userId },
      include: { referrer: true }
    });

    if (!referralRecord) {
      console.log(`No referral found for user ${userId}`);
      return null;
    }

    // Check if this is the first deposit
    const previousDeposits = await prisma.transaction.count({
      where: {
        userId: userId,
        type: 'deposit-completed',
        createdAt: { lt: new Date() }
      }
    });

    if (previousDeposits > 1) {
      console.log(`User ${userId} already made deposits before`);
      return null;
    }

    // Check if bonus already given to referrer
    const existingBonus = await prisma.transaction.findFirst({
      where: {
        userId: referralRecord.referrerId,
        type: 'referral_bonus',
        description: { contains: userId }
      }
    });

    if (existingBonus) {
      console.log(`Referral bonus already given for ${userId}`);
      return null;
    }

    const referrerBonus = 50;

    // Give bonus only to referrer
    const result = await prisma.$transaction(async (prisma) => {
      // Give bonus to referrer only
      await prisma.user.update({
        where: { id: referralRecord.referrerId },
        data: { wallet: { increment: referrerBonus } }
      });

      // Create transaction record for referrer only
      await prisma.transaction.create({
        data: {
          userId: referralRecord.referrerId,
          amount: referrerBonus,
          type: 'referral_bonus',
          description: `Referral bonus for referring user ${userId}`
        }
      });

      return { referrerBonus };
    });

    console.log(`💰 Referral bonus processed: Referrer got ₹${referrerBonus}`);
    return result;

  } catch (error) {
    console.error('Error processing referral bonus:', error);
    return null;
  }
};

// Signup controller - minimal changes
const signup = async (req, res) => {
  try {
    const { phoneNumber, password, referralCode } = req.body;

    // Validate phone number format
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

    // Validate referral code if provided
    if (referralCode) {
      const referrer = await prisma.user.findFirst({
        where: { referralCode: referralCode }
      });
      
      if (!referrer) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate 6-digit OTP
    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    // Store OTP temporarily with referral code
    otpStore[phoneNumber] = {
      otp,
      expiresAt: Date.now() + 300000, // 5 minutes
      password: hashedPassword,
      referralCode: referralCode || null
    };

    // console.log(otp);
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

// Verify OTP controller - create referral relationship and give signup bonus to everyone
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
    const signupBonus = 50; // Everyone gets ₹50 on signup

    // Create user with signup bonus
    const user = await prisma.$transaction(async (prisma) => {
      // Create user
      const newUser = await prisma.user.create({
        data: {
          phoneNumber,
          password: storedData.password,
          wallet: signupBonus, // Give signup bonus immediately
          referralCode
        }
      });

      // Create signup bonus transaction
      await prisma.transaction.create({
        data: {
          userId: newUser.id,
          amount: signupBonus,
          type: 'signup_bonus',
          description: 'Welcome bonus for new user'
        }
      });

      return newUser;
    });

    // Create referral relationship if referral code was provided (no bonus yet)
    if (storedData.referralCode) {
      const referrer = await prisma.user.findFirst({
        where: { referralCode: storedData.referralCode }
      });

      if (referrer && referrer.id !== user.id) {
        await prisma.referral.create({
          data: {
            referrerId: referrer.id,
            refereeId: user.id
          }
        });
        console.log(`✅ Referral relationship created: ${referrer.id} -> ${user.id}`);
      }
    }

    // Clean up OTP store
    delete otpStore[phoneNumber];

    // Generate JWT token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      signupBonus: signupBonus,
      referralApplied: !!storedData.referralCode
    });

  } catch (error) {
    console.error('Error in verifyOtp:', error);
    return res.status(500).json({ error: 'Failed to create account' });
  }
};

// Login controller - unchanged
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

// Resend OTP controller - unchanged
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

// Get user data - add referral stats
const getUserData = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        phoneNumber: true,
        wallet: true,
        referralCode: true,
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get simple referral stats
    const totalReferrals = await prisma.referral.count({
      where: { referrerId: user.id }
    });

    const referralEarnings = await prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: 'referral_bonus'
      },
      _sum: { amount: true }
    });

    return res.status(200).json({
      ...user,
      totalReferrals,
      referralEarnings: referralEarnings._sum.amount || 0
    });
  } catch (error) {
    console.error("Token validation error:", error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Games history - unchanged
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
  gamesHistory,
  processReferralBonus // Export this for use in wallet controller
};