// server.js
//
// Entry point. Run with: node server.js  (or nodemon server.js in dev)
//
// Order matters here:
//   1. Connect to MongoDB first — don't accept traffic on a DB-less app.
//   2. Wrap the Express app in a raw http.Server (Socket.io needs this,
//      not the Express app object directly).
//   3. Init Socket.io on that server.
//   4. Start the room-reveal cron job.
//   5. Start listening.

require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");

const app = require("./app");
const { initSocket } = require("./socket");
const { startRoomRevealJob } = require("./jobs/roomReveal");
const { startStaleBookingJob } = require("./jobs/releaseStaleBookings");

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

async function start() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");

    const server = http.createServer(app);

    initSocket(server); // now getIO() works anywhere in the app

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      startRoomRevealJob(); // begins the every-minute room-reveal check
      startStaleBookingJob(); // releases abandoned payment holds
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();

// Fail loudly instead of hanging silently on unexpected errors.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});
