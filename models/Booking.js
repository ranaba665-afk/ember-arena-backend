const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    teamName: {
      type: String,
      trim: true,
    },
    playerIGNs: {
      type: [String], // squad member in-game names
      default: [],
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    payment: {
      razorpayOrderId: { type: String, default: null },
      razorpayPaymentId: { type: String, default: null },
      method: { type: String, default: null }, // e.g. "upi"
    },
    slotHeldAt: {
      type: Date,
      default: Date.now,
      // Useful if you later add "pending payment" holds with expiry
      // (e.g. a TTL index that releases the slot back if payment
      // isn't completed within N minutes).
    },
  },
  { timestamps: true }
);

// Prevent the same user from double-booking the same tournament
bookingSchema.index({ tournament: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Booking", bookingSchema);
