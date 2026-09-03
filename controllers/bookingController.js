const mongoose = require("mongoose");
const Tournament = require("../models/Tournament");
const Booking = require("../models/Booking");
const { getIO } = require("../socket");

/**
 * POST /api/tournaments/:tournamentId/book
 * Books a slot for the logged-in user, safely, even if many
 * requests hit this at the exact same time.
 *
 * The key idea: don't do "read remaining, check > 0, then write"
 * as two separate steps. Two requests can both read remaining = 1
 * at the same time, both think there's room, and both write —
 * that's the race condition (overbooking).
 *
 * Instead, do the check AND the decrement in ONE atomic MongoDB
 * operation using findOneAndUpdate with the condition in the
 * filter itself. MongoDB guarantees only one caller can match and
 * update a given document at a time, so this is race-safe without
 * needing an application-level lock.
 */
exports.bookSlot = async (req, res) => {
  const { tournamentId } = req.params;
  const userId = req.user._id; // from auth middleware
  const { teamName, playerIGNs } = req.body;

  const session = await mongoose.startSession();

  try {
    let booking;

    await session.withTransaction(async () => {
      // Step 1: Atomic check-and-decrement.
      // The filter requires slots.remaining > 0 AND status "upcoming".
      // If another request already dropped remaining to 0 between
      // when we last read and now, this filter simply won't match
      // anything, and updatedTournament comes back null — no slot
      // is wasted, no negative counts happen.
      const updatedTournament = await Tournament.findOneAndUpdate(
        {
          _id: tournamentId,
          status: "upcoming",
          "slots.remaining": { $gt: 0 },
        },
        {
          $inc: { "slots.remaining": -1 },
        },
        { new: true, session }
      );

      if (!updatedTournament) {
        // Either the tournament doesn't exist, isn't open, or is full.
        throw new Error("SLOTS_FULL");
      }

      // Step 2: Create the booking record inside the same transaction.
      // If this fails (e.g. duplicate booking via the unique index),
      // the whole transaction rolls back — including the decrement
      // from Step 1 — so the slot count stays correct.
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
        if (err.code === 11000) {
          throw new Error("ALREADY_BOOKED");
        }
        throw err;
      }
    });

    // Broadcast the new remaining count to anyone viewing this
    // tournament's page, so the slot counter updates live without
    // a page refresh.
    try {
      const fresh = await Tournament.findById(tournamentId).select("slots");
      getIO().to(`tournament:${tournamentId}`).emit("slotUpdated", {
        tournamentId,
        remaining: fresh.slots.remaining,
        total: fresh.slots.total,
      });
    } catch (emitErr) {
      // Never let a socket emit failure fail the booking itself.
      console.error("slotUpdated emit failed:", emitErr);
    }

    return res.status(201).json({
      success: true,
      booking: booking[0],
    });
  } catch (err) {
    if (err.message === "SLOTS_FULL") {
      return res.status(409).json({ success: false, message: "Sorry, all slots are full." });
    }
    if (err.message === "ALREADY_BOOKED") {
      return res.status(409).json({ success: false, message: "You already booked this tournament." });
    }
    console.error("bookSlot error:", err);
    return res.status(500).json({ success: false, message: "Booking failed, please try again." });
  } finally {
    session.endSession();
  }
};

// GET /api/bookings/me
exports.getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate("tournament") // includes room + result fields for the dashboard
      .sort({ createdAt: -1 });

    return res.json({ success: true, bookings });
  } catch (err) {
    console.error("getMyBookings error:", err);
    return res.status(500).json({ success: false, message: "Could not load your bookings." });
  }
};

/**
 * Optional: cancel a booking and give the slot back.
 * Also atomic — increments remaining and removes the booking
 * inside one transaction.
 */
exports.cancelBooking = async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user._id;
  const session = await mongoose.startSession();
  let cancelledTournamentId = null;

  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findOneAndDelete(
        { _id: bookingId, user: userId },
        { session }
      );

      if (!booking) {
        throw new Error("BOOKING_NOT_FOUND");
      }

      cancelledTournamentId = booking.tournament;

      await Tournament.findByIdAndUpdate(
        booking.tournament,
        { $inc: { "slots.remaining": 1 } },
        { session }
      );
    });

    try {
      const fresh = await Tournament.findById(cancelledTournamentId).select("slots");
      if (fresh) {
        getIO().to(`tournament:${fresh._id}`).emit("slotUpdated", {
          tournamentId: fresh._id,
          remaining: fresh.slots.remaining,
          total: fresh.slots.total,
        });
      }
    } catch (emitErr) {
      console.error("slotUpdated emit failed:", emitErr);
    }

    return res.json({ success: true, message: "Booking cancelled, slot released." });
  } catch (err) {
    if (err.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }
    console.error("cancelBooking error:", err);
    return res.status(500).json({ success: false, message: "Cancellation failed." });
  } finally {
    session.endSession();
  }
};
    
