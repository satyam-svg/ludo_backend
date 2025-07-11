// routes/cashfreeRoutes.js
const express = require("express");
const { PaymentController } = require("../controllers/paymentController");
const { authenticateToken } = require('../middleware/authMiddleware');
const router = express.Router();


router.post("/create-order",authenticateToken, PaymentController.createPendingDeposit);
router.get("/transactions",authenticateToken, PaymentController.getSpecificTransactions);
router.get("/pending-deposits",PaymentController.getPendingDepositsSimple);
router.post("/update-deposits",PaymentController.approveRejectPendingDeposit);

//withdrawl
router.post("/create-withdrawl",authenticateToken, PaymentController.createPendingWithdrawal);
router.get("/pending-withdrawl",PaymentController.getPendingWithdrawalsSimple);
router.post("/update-withdrawl",PaymentController.approveRejectPendingWithdrawal);
module.exports = router;
