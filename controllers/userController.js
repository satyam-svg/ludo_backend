const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your_secure_jwt_secret';

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


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'satyammaurya9620@gmail.com',
    pass: 'ycli dqri gfje dtwi'
  }
});


const signup = async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    otpStore[email] = {
      otp,
      expiresAt: Date.now() + 300000,
      password: hashedPassword,
      referralCode
    };

    const mailOptions = {
      from: '"Ludo Kingdom" <satyammaurya9620@gmail.com>',
      to: email,
      subject: 'Your OTP for Ludo Kingdom Signup',
      html: `
        <div>
          <h2>Ludo Kingdom - Account Verification</h2>
          <p>Your OTP is:</p>
          <h1>${otp}</h1>
          <p>Valid for 5 minutes.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      message: 'OTP sent successfully.',
      expiresIn: 300
    });

  } catch (error) {
    console.error('Error in signup:', error);
    return res.status(500).json({ error: 'Failed to process signup' });
  }
};

// Verify OTP controller
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const storedData = otpStore[email];

  if (!storedData || Date.now() > storedData.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired or not found' });
  }

  if (storedData.otp !== otp) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  try {
    const referralCode = await generateReferralCode();

    const user = await prisma.user.create({
      data: {
        email,
        password: storedData.password,
        wallet: 0,
        referralCode
      }
    });

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

        await prisma.user.update({
          where: { id: referrer.id },
          data: { wallet: { increment: bonusAmount } }
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { wallet: { increment: bonusAmount } }
        });

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

    delete otpStore[email];

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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
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
        email: true,
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
  getUserData
};
