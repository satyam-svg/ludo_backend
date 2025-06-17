const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');
const bcrypt = require('bcrypt');

const otpStore = {};

// Helper function to generate unique 8-digit referral code
const generateReferralCode = async () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = '';
    for (let i = 0; i < 8; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    // Check if code is unique
    const existingUser = await prisma.user.findFirst({
      where: { referralCode: code },
    });
    
    if (!existingUser) {
      isUnique = true;
    }
  }
  
  return code;
};

// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'satyammaurya9620@gmail.com',
    pass: 'ycli dqri gfje dtwi'
  }
});

// Signup controller
const signup = async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate 6-digit OTP
    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    // Store OTP with expiration and user data
    otpStore[email] = {
      otp,
      expiresAt: Date.now() + 300000, // 5 minutes
      password: hashedPassword,
      referralCode
    };

    // Email content
    const mailOptions = {
      from: '"Ludo Kingdom" <satyammaurya9620@gmail.com>',
      to: email,
      subject: 'Your OTP for Ludo Kingdom Signup',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Ludo Kingdom - Account Verification</h2>
          <p>Your One-Time Password (OTP) to complete your registration is:</p>
          <h1 style="background: #0f3460; 
                     color: white; 
                     padding: 10px 20px; 
                     display: inline-block;
                     border-radius: 5px;">
            ${otp}
          </h1>
          <p>This OTP is valid for 5 minutes. Please do not share it with anyone.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr>
          <p style="color: #666;">Happy Gaming!<br>Ludo Kingdom Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      message: 'OTP sent successfully. Please verify to complete registration.',
      expiresIn: 300
    });

  } catch (error) {
    console.error('Error in signup:', error);
    return res.status(500).json({ error: 'Failed to process signup' });
  }
};

// Login controller
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare passwords
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Return user data without password
    const { password: _, ...userData } = user;
    
    return res.status(200).json({
      message: 'Login successful',
      user: userData
    });

  } catch (error) {
    console.error('Error in login:', error);
    return res.status(500).json({ error: 'Failed to process login' });
  }
};

// Verify OTP for signup completion
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const storedData = otpStore[email];

  if (!storedData) {
    return res.status(400).json({ error: 'OTP not found or expired' });
  }

  if (Date.now() > storedData.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired' });
  }

  if (storedData.otp === otp) {
    try {
      // Generate unique referral code for new user
      const referralCode = await generateReferralCode();
      
      // Create new user
      const user = await prisma.user.create({
        data: {
          email,
          password: storedData.password,
          wallet: 0,
          referralCode
        }
      });

      // Process referral if valid code was provided
      if (storedData.referralCode) {
        const referrer = await prisma.user.findFirst({
          where: { referralCode: storedData.referralCode }
        });

        if (referrer && referrer.id !== user.id) {
          // Create referral relationship
          await prisma.referral.create({
            data: {
              referrer: { connect: { id: referrer.id } },
              referee: { connect: { id: user.id } }
            }
          });

          // Add bonus to both users
          const bonusAmount = 10;
          
          // Update wallets
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

      delete otpStore[email];
      
      // Return user data without password
      const { password, ...userData } = user;
      
      return res.status(201).json({
        message: 'Account created successfully',
        user: userData
      });

    } catch (error) {
      console.error('Error in verifyOtp:', error);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  }

  return res.status(400).json({ error: 'Invalid OTP' });
};

module.exports = { signup, login, verifyOtp };