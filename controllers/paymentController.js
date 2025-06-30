// controllers/cashfreeController.js
const { Cashfree, CFEnvironment } = require("cashfree-pg");

// Create Cashfree instance (use environment variables in production!)
const cashfree = new Cashfree(
  CFEnvironment.SANDBOX,
  "TEST10425277efcafe2fcd655e7db31577252401", // client ID
  "cfsk_ma_test_7b788c1d22508852b630d69855d44859_e524b62e" // client secret
);

// Controller function to create a Cashfree order
const createCashfreeOrder = async (req, res) => {
  try {
    const request = {
      order_amount: "1",
      order_currency: "INR",
      customer_details: {
        customer_id: "node_sdk_test",
        customer_name: "John Doe",
        customer_email: "example@gmail.com",
        customer_phone: "9999999999",
      },
      order_meta: {
        return_url:
          "https://test.cashfree.com/pgappsdemos/return.php?order_id=order_123",
      },
      order_note: "",
    };

    const response = await cashfree.PGCreateOrder(request);
    const data = response.data;

    const paymentSessionId = data.payment_session_id;
    const paymentPageUrl = `https://sandbox.cashfree.com/pg/view/payment?payment_session_id=${paymentSessionId}`;

    res.status(200).json({
      success: true,
      paymentSessionId,
      paymentPageUrl,
    });
  } catch (error) {
    console.error("❌ Error creating order:", error?.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error?.response?.data || error.message,
    });
  }
};

module.exports = { createCashfreeOrder };
