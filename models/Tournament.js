const mongoose = require("mongoose");

const tournamentSchema = new mongoose.Schema(
  {
    gameName: {
      type: String,
      required: true,
      default: "Free Fire",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    banner: {
      type: String, // image URL
    },
    entryFee: {
      type: Number,
      required: true,
      default: 0,
    },
    prizePool: {
      type: Number,
      required: true,
    },
    slots: {
      total: {
        type: Number,
        required: true,
      },
      remaining: {
        type: Number,
        required: true,
      },
    },
    schedule: {
      type: Date,
      required: true, // exact match start time
    },
    rules: {
      type: String,
    },
    status: {
      type: String,
      enum: ["upcoming", "live", "completed", "cancelled"],
      default: "upcoming",
    },

    // Room details — hidden from players until reveal time
    room: {
      roomId: { type: String, default: null },
      password: { type: String, default: null },
      isRevealed: { type: Boolean, default: false },
      revealedAt: { type: Date, default: null },
    },

    // Filled in by admin after the match ends
    result: {
      winnerTeam: { type: String, default: null },
      announced: { type: Boolean, default: false },
      announcedAt: { type: Date, default: null },
      // Payout = crediting the prize pool to the winner's in-app
      // wallet (there's no bank-transfer integration set up).
      payoutStatus: {
        type: String,
        enum: ["not_applicable", "pending", "paid"],
        default: "not_applicable",
      },
      payoutAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Helpful index for the cron job query (status + schedule range scan)
tournamentSchema.index({ status: 1, "room.isRevealed": 1, schedule: 1 });

module.exports = mongoose.model("Tournament", tournamentSchema);
