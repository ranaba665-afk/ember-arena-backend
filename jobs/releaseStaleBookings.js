// jobs/releaseStaleBookings.js
//
// Safety net for the case where a user starts payment (slot gets
// reserved) but never finishes — closes the tab, UPI app times out,
// no webhook ever fires. Without this, that slot would stay locked
// forever. Runs every minute; releases any "pending" booking older
// than PAYMENT_WINDOW_MINUTES.

const cron = require("node-cron");
const mongoose = require("mongoose");
const Tournament = require("../models/Tournament");
const Booking = require("../models/Booking");
const { getIO } = require("../socket");

const PAYMENT_WINDOW_MINUTES = 15;

async function releaseStaleBookings() {
  const cutoff = new Date(Date.now() - PAYMENT_WINDOW_MINUTES * 60 * 1000);

  const stale = await Booking.find({
    paymentStatus: "pending",
    slotHeldAt: { $lt: cutoff },
    "payment.razorpayOrderId": { $ne: null }, // only paid-tournament bookings hold slots this way
  });

  for (const booking of stale) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await Booking.findOneAndUpdate(
          { _id: booking._id, paymentStatus: "pending" },
          { paymentStatus: "failed" },
          { session }
        );
        if (!updated) return;

        await Tournament.findByIdAndUpdate(
          booking.tournament,
          { $inc: { "slots.remaining": 1 } },
          { session }
        );
      });

      const fresh = await Tournament.findById(booking.tournament).select("slots");
      if (fresh) {
        getIO().to(`tournament:${booking.tournament}`).emit("slotUpdated", {
          tournamentId: booking.tournament,
          remaining: fresh.slots.remaining,
          total: fresh.slots.total,
        });
      }
    } catch (err) {
      console.error("releaseStaleBookings error for booking", booking._id, err);
    } finally {
      session.endSession();
    }
  }

  if (stale.length > 0) {
    console.log(`[releaseStaleBookings] Released ${stale.length} expired payment hold(s).`);
  }
}

function startStaleBookingJob() {
  cron.schedule("* * * * *", releaseStaleBookings);
  console.log("[releaseStaleBookings] Cron job scheduled (every minute).");
}

module.exports = { startStaleBookingJob, releaseStaleBookings };
