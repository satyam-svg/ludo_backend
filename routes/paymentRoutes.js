// routes/paymentRoutes.js
const express = require('express');
const {
  createOrder,
  webhookHandler,
  verifyPayment
} = require('../controllers/paymentController');


const router = express.Router();

router.post('/create-order',  createOrder);
router.post('/webhook', webhookHandler);
router.get('/verify/:orderId', verifyPayment);

module.exports = router; // ✅ Important for CommonJS
