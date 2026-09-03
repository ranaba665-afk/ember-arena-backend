// controllers/paymentController.js
//
// Flow:
//   1. POST /api/tournaments/:id/create-order
//      - Atomically reserves a slot (same findOneAndUpdate pattern as
//        bookingController) and creates a Booking with paymentStatus
//        "pending" — this HOLDS the slot while the user pays.
//      - Creates a Razorpay Order for the entry fee.
//      - Returns the order + Razorpay key so the frontend can open
//        Checkout with UPI as the primary method.
//   2. Frontend opens Razorpay Checkout, user pays via GPay/PhonePe/
//      Paytm/UPI QR.
//   3. Razorpay calls our webhook (server-to-server, not the browser)
//      with the payment result. We verify the signature, then mark
//      the booking "paid" — this is the ONLY place a booking is
//      confirmed. Never trust a client-side "payment succeeded"
//      callback for this, since that can be spoofed.
//   4. If payment fails/expires, jobs/releaseStaleBookings.js gives
//      the slot back automatically.

const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");

const Tournament = require("../models/Tournament");
const Booking = require("../models/Booking");
const { getIO } = require("../socket");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// POST /api/tournaments/:tournamentId/create-order
exports.createOrder = async (req, res) => {
  const { tournamentId } = req.params;
  const userId = req.user._id;
  const { teamName, playerIGNs } = req.body;

  const session = await mongoose.startSession();

  try {
    let booking, tournament;

    await session.withTransaction(async () => {
      // Same atomic check-and-decrement as the free-entry booking flow —
      // this is what actually prevents overbooking, payment or not.
      tournament = await Tournament.findOneAndUpdate(
        {
          _id: tournamentId,
          status: "upcoming",
          "slots.remaining": { $gt: 0 },
        },
        { $inc: { "slots.remaining": -1 } },
        { new: true, session }
      );

      if (!tournament) {
        throw new Error("SLOTS_FULL");
      }

      try {
        booking = await Booking.create(
          [
            {
              tournament: tournamentId,
              user: userId,
              teamName,
              playerIGNs,
              paymentStatus: "pending",
            },
          ],
          { session }
        );
      } catch (err) {
        if (err.code === 11000) throw new Error("ALREADY_BOOKED");
        throw err;
      }
    });

    booking = booking[0];

    // Free tournaments skip payment entirely and are confirmed immediately.
    if (tournament.entryFee === 0) {
      booking.paymentStatus = "paid";
      await booking.save();
      return res.status(201).json({ success: true, free: true, booking });
    }

    const order = await razorpay.orders.create({
      amount: tournament.entryFee * 100, // paise
      currency: "INR",
      receipt: `booking_${booking._id}`,
      notes: { bookingId: booking._id.toString(), tournamentId },
    });

    booking.payment.razorpayOrderId = order.id;
    await booking.save();

    broadcastSlotCount(tournament._id);

    return res.status(201).json({
      success: true,
      free: false,
      bookingId: booking._id,
      order: { id: order.id, amount: order.amount, currency: order.currency },
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      prefill: { name: req.user.name, email: req.user.email, contact: req.user.phone },
    });
  } catch (err) {
    if (err.message === "SLOTS_FULL") {
      return res.status(409).json({ success: false, message: "Sorry, all slots are full." });
    }
    if (err.message === "ALREADY_BOOKED") {
      return res.status(409).json({ success: false, message: "You already booked this tournament." });
    }
    console.error("createOrder error:", err);
    return res.status(500).json({ success: false, message: "Could not start payment, please try again." });
  } finally {
    session.endSession();
  }
};

// POST /api/payments/webhook
// Mounted with express.raw() in app.js — signature verification needs
// the exact raw request body, not the parsed JSON.
exports.razorpayWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body) // raw Buffer
    .digest("hex");

  if (signature !== expected) {
    // Don't process anything we can't verify came from Razorpay.
    return res.status(400).json({ success: false, message: "Invalid signature." });
  }

  const payload = JSON.parse(req.body.toString());
  const event = payload.event;

  try {
    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const bookingId = payment.notes?.bookingId;

      const booking = await Booking.findByIdAndUpdate(
        bookingId,
        {
          paymentStatus: "paid",
          "payment.razorpayPaymentId": payment.id,
          "payment.method": payment.method, // "upi", "card", etc.
        },
        { new: true }
      );

      if (booking) {
        getIO().to(`tournament:${booking.tournament}`).emit("paymentConfirmed", {
          bookingId: booking._id,
          tournamentId: booking.tournament,
        });
      }
    }

    if (event === "payment.failed") {
      const payment = payload.payload.payment.entity;
      const bookingId = payment.notes?.bookingId;
      await releaseFailedBooking(bookingId);
    }

    // Razorpay expects a 200 quickly, or it will retry the webhook.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("razorpayWebhook error:", err);
    // Still 200 here in most setups is debated — returning 500 makes
    // Razorpay retry, which is usually what you want for a transient
    // DB error rather than silently losing the event.
    return res.status(500).json({ success: false });
  }
};

async function releaseFailedBooking(bookingId) {
  const session = await mongoose.startSession();
  let tournamentId = null;
  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findOneAndUpdate(
        { _id: bookingId, paymentStatus: "pending" },
        { paymentStatus: "failed" },
        { session }
      );
      if (!booking) return; // already handled or not pending anymore

      tournamentId = booking.tournament;
      await Tournament.findByIdAndUpdate(
        tournamentId,
        { $inc: { "slots.remaining": 1 } },
        { session }
      );
    });
    if (tournamentId) await broadcastSlotCount(tournamentId);
  } finally {
    session.endSession();
  }
}

async function broadcastSlotCount(tournamentId) {
  try {
    const fresh = await Tournament.findById(tournamentId).select("slots");
    if (fresh) {
      getIO().to(`tournament:${tournamentId}`).emit("slotUpdated", {
        tournamentId,
        remaining: fresh.slots.remaining,
        total: fresh.slots.total,
      });
    }
  } catch (err) {
    console.error("slotUpdated emit failed:", err);
  }
    }

