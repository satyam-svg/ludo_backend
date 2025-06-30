// routes/cashfreeRoutes.js
const express = require("express");
const { createCashfreeOrder } = require("../controllers/paymentController");
const router = express.Router();


router.post("/create-order", createCashfreeOrder);

module.exports = router;
