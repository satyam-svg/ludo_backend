const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();
const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');

const otpStore = {};

// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'satyammaurya9620@gmail.com',
    pass: 'ycli dqri gfje dtwi'
  }
});

const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    let user = await prisma.user.findUnique({ where: { email } });

    // If not, create a new user
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          wallet: 0,
        }
      });
    }

    // Generate 6-digit OTP
    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    // Store OTP with expiration
    otpStore[email] = {
      otp,
      expiresAt: Date.now() + 300000 // 5 minutes
    };

    // Email content
    const mailOptions = {
      from: '"Ludo Kingdom" <satyammaurya9620@gmail.com>',
      to: email,
      subject: 'Your OTP for Ludo Kingdom',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Ludo Kingdom - OTP Verification</h2>
          <p>Your One-Time Password (OTP) for login is:</p>
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
      message: 'OTP sent successfully',
      expiresIn: 300
    });

  } catch (error) {
    console.error('Error in sendOtp:', error);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
};

const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const storedOtp = otpStore[email];

  if (!storedOtp) {
    return res.status(400).json({ error: 'OTP not found or expired' });
  }

  if (Date.now() > storedOtp.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired' });
  }

  if (storedOtp.otp === otp) {
    delete otpStore[email];
    
    // Fetch user after verification
    const user = await prisma.user.findUnique({ where: { email } });

    return res.status(200).json({
      message: 'OTP verified successfully',
      user: {
        id: user.id,
        email: user.email,
        wallet: user.wallet
      }
    });
  }

  return res.status(400).json({ error: 'Invalid OTP' });
};

module.exports = { sendOtp, verifyOtp };
