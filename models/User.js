const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      unique: true,
      sparse: true, // allows null but enforces uniqueness when present
    },
    password: {
      type: String,
      required: true, // store bcrypt hash, never plain text
      select: false, // excluded from queries by default
    },
    gameId: {
      type: String, // e.g. BGMI/Free Fire character ID
      trim: true,
    },
    ign: {
      type: String, // In-Game Name
      trim: true,
    },
    wallet: {
      balance: {
        type: Number,
        default: 0,
      },
      // For demo builds, keep this UI-only (no real deduction logic).
      // For production, every change should go through a Transaction
      // collection/ledger instead of direct balance edits.
    },
    role: {
      type: String,
      enum: ["player", "admin"],
      default: "player",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
