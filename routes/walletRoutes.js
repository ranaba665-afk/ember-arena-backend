const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getWallet, createTopUpOrder } = require("../controllers/walletController");

router.get("/", protect, getWallet);
router.post("/topup/create-order", protect, createTopUpOrder);

module.exports = router;
