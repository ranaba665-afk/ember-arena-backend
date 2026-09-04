// app.js
//
// Express app configuration only — no listen() here. server.js
// creates the HTTP server (needed for Socket.io) and starts it.
// Keeping them separate also makes the app importable in tests
// without opening a real port.

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const tournamentRoutes = require("./routes/tournamentRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const adminRoutes = require("./routes/adminRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const walletRoutes = require("./routes/walletRoutes");
const { razorpayWebhook } = require("./controllers/paymentController");

const app = express();

// ---- Core middleware ----
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

// IMPORTANT: the Razorpay webhook needs the raw request body to verify
// the signature, so it's mounted with express.raw() BEFORE the global
// express.json() below. If this were after express.json(), the body
// would already be parsed into an object and signature verification
// would fail.
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  razorpayWebhook
);

app.use(express.json()); // parses application/json request bodies for everything else

// ---- Health check (useful for Render/AWS uptime checks) ----
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---- Routes ----
app.use("/api/auth", authRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/wallet", walletRoutes);

// ---- 404 fallback ----
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// ---- Central error handler ----
// Catches anything thrown/passed to next(err) that individual
// controllers didn't already handle themselves.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Something went wrong on our end.",
  });
});

module.exports = app;
