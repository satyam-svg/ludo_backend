const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const otpGenerator = require('otp-generator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your_secure_jwt_secret';
const FAST2SMS_API_KEY = 'dont expose use locally api key'; // Replace with your actual API key

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
    console.log("Incoming token:", token);

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("Decoded user:", decoded);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        phoneNumber: true,
        wallet: true,
        referralCode: true,
      }
    });
    console.log(user);

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json(user);
  } catch (error) {
    console.error("Token validation error:", error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = {
  signup,
  verifyOtp,
  login,
  getUserData,
  resendOtp
};