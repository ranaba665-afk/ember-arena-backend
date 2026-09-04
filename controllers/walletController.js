// controllers/walletController.js
//
// Adds a wallet on top of the existing direct-UPI booking flow:
//   - Top up: user creates a Razorpay order for adding money; the
//     webhook (in paymentController.js) credits the wallet once
//     payment is captured — same "server confirms, not the client"
//     pattern used for booking payments.
//   - Book with wallet: debits the wallet and reserves the slot in
//     ONE atomic transaction, so it's instant (no waiting on a
//     webhook) — the money is already in the account, no external
//     payment gateway round-trip needed.

const mongoose = require("mongoose");
const Razorpay = require("razorpay");

const User = require("../models/User");
const Tournament = require("../models/Tournament");
const Booking = require("../models/Booking");
const Transaction = require("../models/Transaction");
const { getIO } = require("../socket");
const { broadcastSlotCount } = require("./paymentController");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// GET /api/wallet
exports.getWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("wallet");
    const transactions = await Transaction.find({ user: req.user._id, status: { $ne: "pending" } })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({
      success: true,
      balance: user.wallet.balance,
      transactions,
    });
  } catch (err) {
    console.error("getWallet error:", err);
    return res.status(500).json({ success: false, message: "Could not load wallet." });
  }
};

// POST /api/wallet/topup/create-order
exports.createTopUpOrder = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 10) {
      return res.status(400).json({ success: false, message: "Minimum top-up amount is ৳10." });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: `topup_${req.user._id}_${Date.now()}`,
      notes: {
        type: "wallet_topup", // the webhook branches on this
        userId: req.user._id.toString(),
      },
    });

    await Transaction.create({
      user: req.user._id,
      type: "topup",
      amount,
      balanceAfter: null, // filled in once the webhook confirms
      razorpayOrderId: order.id,
      status: "pending",
    });

    return res.status(201).json({
      success: true,
      order: { id: order.id, amount: order.amount, currency: order.currency },
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      prefill: { name: req.user.name, email: req.user.email, contact: req.user.phone },
    });
  } catch (err) {
    console.error("createTopUpOrder error:", err);
    return res.status(500).json({ success: false, message: "Could not start top-up, please try again." });
  }
};

// POST /api/tournaments/:tournamentId/book-with-wallet
exports.bookWithWallet = async (req, res) => {
  const { tournamentId } = req.params;
  const userId = req.user._id;
  const { teamName, playerIGNs } = req.body;

  const session = await mongoose.startSession();

  try {
    let booking, tournament, debitedUser;

    await session.withTransaction(async () => {
      // Same atomic slot reservation as the UPI flow.
      tournament = await Tournament.findOneAndUpdate(
        { _id: tournamentId, status: "upcoming", "slots.remaining": { $gt: 0 } },
        { $inc: { "slots.remaining": -1 } },
        { new: true, session }
      );
      if (!tournament) throw new Error("SLOTS_FULL");

      if (tournament.entryFee > 0) {
        // Check-and-debit in one atomic op — same pattern as the slot
        // check: the balance condition lives in the filter itself, so
        // two simultaneous bookings can't both succeed against a
        // balance that only covers one of them.
        debitedUser = await User.findOneAndUpdate(
          { _id: userId, "wallet.balance": { $gte: tournament.entryFee } },
          { $inc: { "wallet.balance": -tournament.entryFee } },
          { new: true, session }
        );
        if (!debitedUser) throw new Error("INSUFFICIENT_BALANCE");
      }

      try {
        booking = await Booking.create(
          [
            {
              tournament: tournamentId,
              user: userId,
              teamName,
              playerIGNs,
              paymentStatus: "paid", // wallet debit is immediate, no webhook to wait on
              payment: { method: "wallet" },
            },
          ],
          { session }
        );
      } catch (err) {
        if (err.code === 11000) throw new Error("ALREADY_BOOKED");
        throw err;
      }

      if (tournament.entryFee > 0) {
        await Transaction.create(
          [
            {
              user: userId,
              type: "booking_debit",
              amount: tournament.entryFee,
              balanceAfter: debitedUser.wallet.balance,
              relatedBooking: booking[0]._id,
              status: "success",
            },
          ],
          { session }
        );
      }
    });

    booking = booking[0];
    await broadcastSlotCount(tournamentId);
    if (tournament.entryFee > 0) {
      getIO().to(`tournament:${tournamentId}`).emit("paymentConfirmed", {
        bookingId: booking._id,
        tournamentId,
      });
    }

    return res.status(201).json({ success: true, booking, walletBalance: debitedUser?.wallet.balance });
  } catch (err) {
    if (err.message === "SLOTS_FULL") {
      return res.status(409).json({ success: false, message: "Sorry, all slots are full." });
    }
    if (err.message === "INSUFFICIENT_BALANCE") {
      return res.status(402).json({ success: false, message: "Insufficient wallet balance. Please add money to your wallet." });
    }
    if (err.message === "ALREADY_BOOKED") {
      return res.status(409).json({ success: false, message: "You already booked this tournament." });
    }
    console.error("bookWithWallet error:", err);
    return res.status(500).json({ success: false, message: "Booking failed, please try again." });
  } finally {
    session.endSession();
  }
};
  
