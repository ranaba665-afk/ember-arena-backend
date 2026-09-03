/**
 * Room ID/Password auto-reveal job.
 *
 * Approach: run a scheduler every minute. Each run, find tournaments
 * that are starting in the next 10 minutes and haven't had their
 * room revealed yet, then flip isRevealed = true. The dashboard API
 * simply checks isRevealed before showing roomId/password to players,
 * so no separate "push" step is needed — reveal is just a DB flag flip.
 *
 * Requires: npm install node-cron
 */

const cron = require("node-cron");
const Tournament = require("../models/Tournament");

async function revealDueRooms() {
  const now = new Date();
  const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);

  try {
    // Match tournaments whose schedule falls within the next 10 minutes
    // and whose room hasn't been revealed yet. updateMany is fine here
    // (no race condition risk — revealing twice has no bad side effect,
    // unlike decrementing a slot count).
    const result = await Tournament.updateMany(
      {
        status: "upcoming",
        schedule: { $gte: now, $lte: tenMinutesFromNow },
        "room.isRevealed": false,
        "room.roomId": { $ne: null }, // admin must have set the room first
      },
      {
        $set: {
          "room.isRevealed": true,
          "room.revealedAt": now,
        },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[roomReveal] Revealed room details for ${result.modifiedCount} tournament(s).`);
      // Optional: emit a Socket.io event here so dashboards update live
      // without needing to poll, e.g.:
      // io.to(`tournament:${tournament._id}`).emit("roomRevealed", { roomId, password });
    }
  } catch (err) {
    console.error("[roomReveal] Failed:", err);
  }
}

// Runs at the start of every minute: "* * * * *"
function startRoomRevealJob() {
  cron.schedule("* * * * *", revealDueRooms);
  console.log("[roomReveal] Cron job scheduled (every minute).");
}

module.exports = { startRoomRevealJob, revealDueRooms };

/**
 * In your main server file (e.g. server.js / index.js):
 *
 *   const { startRoomRevealJob } = require("./jobs/roomReveal");
 *   mongoose.connect(process.env.MONGO_URI).then(() => {
 *     app.listen(PORT, () => console.log("Server running"));
 *     startRoomRevealJob();
 *   });
 */
