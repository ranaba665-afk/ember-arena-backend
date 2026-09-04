const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["topup", "booking_debit", "refund", "prize"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    // Balance right after this transaction applied — makes the
    // history self-explanatory without recomputing from scratch.
    // Left null for a pending top-up until the webhook confirms it.
    balanceAfter: {
      type: Number,
      default: null,
    },
    relatedBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

transactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
