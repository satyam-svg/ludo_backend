import axios from 'axios';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Environment configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '87204864471c7644bc8b77bfb2840278';
const CASHFREE_SECRET = process.env.CASHFREE_SECRET || 'cfsk_ma_prod_4e4beb223d75e34a656b8486194297a0_7c57ef25';
const CASHFREE_ENV = process.env.CASHFREE_ENV || 'PRODUCTION';
const CASHFREE_BASE_URL = CASHFREE_ENV === 'PRODUCTION' 
  ? 'https://api.cashfree.com/pg' 
  : 'https://sandbox.cashfree.com/pg';

// Helper function to generate headers
const getCashfreeHeaders = () => ({
  'x-client-id': CASHFREE_APP_ID,
  'x-client-secret': CASHFREE_SECRET,
  'x-api-version': '2022-09-01',
  'Content-Type': 'application/json'
});

// ========================================
// ✅ CREATE ORDER
// ========================================
export const createOrder = async (req, res) => {
  try {
    const { amount, userId, userEmail, userPhone } = req.body;

    // Validate input
    if (!amount || !userId || !userPhone) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['amount', 'userId', 'userPhone']
      });
    }

    // Generate unique order ID
    const order_id = `ORDER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Step 1: Create Cashfree order
    const orderResponse = await axios.post(
      `${CASHFREE_BASE_URL}/orders`,
      {
        order_id,
        order_amount: Number(amount),
        order_currency: 'INR',
        customer_details: {
          customer_id: userId,
          customer_email: userEmail || 'example@email.com',
          customer_phone: userPhone
        }
      },
      { headers: getCashfreeHeaders() }
    );

    // Step 2: Generate payment token
    const tokenResponse = await axios.post(
      `${CASHFREE_BASE_URL}/orders/${order_id}/token`,
      {
        order_amount: Number(amount),
        order_currency: 'INR'
      },
      { headers: getCashfreeHeaders() }
    );

    // Return payment session details
    return res.status(200).json({
      success: true,
      order_id,
      payment_session_id: tokenResponse.data.payment_session_id,
      message: 'Payment session created successfully'
    });

  } catch (error) {
    console.error('Cashfree API Error:', error.response?.data || error.message);
    
    // Detailed error response
    return res.status(500).json({
      success: false,
      error: 'Payment gateway error',
      api_error: error.response?.data || error.message,
      endpoint: `${CASHFREE_BASE_URL}/orders`
    });
  }
};

// ========================================
// ✅ WEBHOOK HANDLER
// ========================================
export const webhookHandler = async (req, res) => {
  try {
    const signature = req.headers['x-cf-signature'];
    const rawBody = JSON.stringify(req.body);

    // Verify signature for security
    const generatedSignature = crypto
      .createHmac('sha256', CASHFREE_SECRET)
      .update(rawBody)
      .digest('base64');

    if (signature !== generatedSignature) {
      console.warn('Invalid webhook signature:', { received: signature, generated: generatedSignature });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { order_id, order_amount, payment_status, customer_details } = req.body;
    
    // Process successful payments
    if (payment_status === 'SUCCESS') {
      try {
        // Update user wallet
        await prisma.user.update({
          where: { id: customer_details.customer_id },
          data: {
            wallet: {
              increment: parseFloat(order_amount)
            }
          }
        });

        // Create transaction record
        await prisma.transaction.create({
          data: {
            userId: customer_details.customer_id,
            amount: parseFloat(order_amount),
            type: 'deposit',
            status: 'completed',
            reference: order_id
          }
        });

        console.log(`Wallet updated for user ${customer_details.customer_id}: +₹${order_amount}`);
      } catch (dbError) {
        console.error('Database update error:', dbError);
        // Implement retry logic or manual reconciliation here
        return res.status(500).json({ error: 'Database update failed' });
      }
    } else {
      console.log(`Payment not successful for order ${order_id}: ${payment_status}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
};

// ========================================
// ✅ VERIFY PAYMENT
// ========================================
export const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Fetch payment details from Cashfree
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/orders/${orderId}/payments`,
      { headers: getCashfreeHeaders() }
    );

    // Find successful payment
    const successfulPayment = response.data?.find(
      payment => payment.payment_status === 'SUCCESS'
    );

    if (successfulPayment) {
      return res.json({ 
        status: 'SUCCESS',
        payment_details: {
          amount: successfulPayment.order_amount,
          currency: successfulPayment.order_currency,
          method: successfulPayment.payment_method,
          time: successfulPayment.payment_completion_time
        }
      });
    }

    return res.json({ status: 'PENDING' });
  } catch (error) {
    console.error('Payment verification error:', error.response?.data || error.message);
    
    // Handle order not found specifically
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'Order not found',
        message: 'The specified order ID does not exist in Cashfree system'
      });
    }
    
    return res.status(500).json({
      error: 'Verification failed',
      detail: error.response?.data || error.message
    });
  }
};

// ========================================
// ✅ GET PAYMENT METHODS
// ========================================
export const getPaymentMethods = async (req, res) => {
  try {
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/payment-methods`,
      { headers: getCashfreeHeaders() }
    );
    
    return res.status(200).json({
      success: true,
      payment_methods: response.data
    });
  } catch (error) {
    console.error('Payment methods error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch payment methods'
    });
  }
};