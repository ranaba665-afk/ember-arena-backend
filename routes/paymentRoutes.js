const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { createOrder } = require("../controllers/paymentController");

router.post("/tournaments/:tournamentId/create-order", protect, createOrder);

module.exports = router;
