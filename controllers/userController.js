const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');

// In-memory storage for OTPs (use database in production)
const otpStore = {};

// Create transporter with your Gmail credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'satyammaurya9620@gmail.com',
    pass: 'ycli dqri gfje dtwi' // Your app password
  }
});

const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Generate 6-digit OTP
    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      specialChars: false,
      lowerCaseAlphabets: false,
      digits: true
    });

    // Store OTP with expiration (5 minutes)
    otpStore[email] = {
      otp,
      expiresAt: Date.now() + 300000 // 5 minutes
    };

    // Email configuration
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

    // Send email
    await transporter.sendMail(mailOptions);
    
    res.status(200).json({ 
      message: 'OTP sent successfully',
      expiresIn: 300 // 5 minutes in seconds
    });
    
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

const verifyOtp = (req, res) => {
  const { email, otp } = req.body;
  
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }
  
  const storedOtp = otpStore[email];
  
  if (!storedOtp) {
    return res.status(400).json({ error: 'OTP not found or expired' });
  }
  
  // Check expiration
  if (Date.now() > storedOtp.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired' });
  }
  
  // Verify OTP
  if (storedOtp.otp === otp) {
    delete otpStore[email];
    return res.status(200).json({ message: 'OTP verified successfully' });
  }
  
  res.status(400).json({ error: 'Invalid OTP' });
};

module.exports = { sendOtp, verifyOtp };