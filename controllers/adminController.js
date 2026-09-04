const mongoose = require("mongoose");
const Tournament = require("../models/Tournament");
const Booking = require("../models/Booking");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { getIO } = require("../socket");

// POST /api/admin/tournaments
exports.createTournament = async (req, res) => {
  try {
    const { title, gameName, banner, entryFee, prizePool, totalSlots, schedule, rules } = req.body;

    const tournament = await Tournament.create({
      title,
      gameName,
      banner,
      entryFee,
      prizePool,
      schedule,
      rules,
      slots: { total: totalSlots, remaining: totalSlots },
    });

    return res.status(201).json({ success: true, tournament });
  } catch (err) {
    console.error("createTournament error:", err);
    return res.status(500).json({ success: false, message: "Could not create tournament." });
  }
};

// PUT /api/admin/tournaments/:id
exports.updateTournament = async (req, res) => {
  try {
    const { title, banner, entryFee, prizePool, schedule, rules, status } = req.body;

    const tournament = await Tournament.findByIdAndUpdate(
      req.params.id,
      { title, banner, entryFee, prizePool, schedule, rules, status },
      { new: true, runValidators: true }
    );

    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    return res.json({ success: true, tournament });
  } catch (err) {
    console.error("updateTournament error:", err);
    return res.status(500).json({ success: false, message: "Could not update tournament." });
  }
};

// PATCH /api/admin/tournaments/:id/room
exports.setRoomDetails = async (req, res) => {
  try {
    const { roomId, password, revealNow } = req.body;

    const update = {
      "room.roomId": roomId,
      "room.password": password,
    };
    if (revealNow) {
      update["room.isRevealed"] = true;
      update["room.revealedAt"] = new Date();
    }

    const tournament = await Tournament.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    if (revealNow) {
      getIO().to(`tournament:${tournament._id}`).emit("roomRevealed", {
        tournamentId: tournament._id,
        roomId: tournament.room.roomId,
        password: tournament.room.password,
      });
    }

    return res.json({ success: true, tournament });
  } catch (err) {
    console.error("setRoomDetails error:", err);
    return res.status(500).json({ success: false, message: "Could not update room details." });
  }
};

// PATCH /api/admin/tournaments/:id/result
exports.announceResult = async (req, res) => {
  try {
    const { winnerTeam } = req.body;

    const tournament = await Tournament.findByIdAndUpdate(
      req.params.id,
      {
        status: "completed",
        "result.winnerTeam": winnerTeam,
        "result.announced": true,
        "result.announcedAt": new Date(),
      },
      { new: true }
    );

    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }

    if (tournament.prizePool > 0) {
      tournament.result.payoutStatus = "pending";
      await tournament.save();
    }

    getIO().to(`tournament:${tournament._id}`).emit("resultAnnounced", {
      tournamentId: tournament._id,
      winnerTeam,
    });

    return res.json({ success: true, tournament });
  } catch (err) {
    console.error("announceResult error:", err);
    return res.status(500).json({ success: false, message: "Could not announce result." });
  }
};

// GET /api/admin/tournaments/:id/bookings
// Booking list for one tournament — who's registered, with what team,
// and their payment status.
exports.listTournamentBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ tournament: req.params.id })
      .populate("user", "name email ign gameId")
      .sort({ createdAt: -1 });

    return res.json({ success: true, bookings });
  } catch (err) {
    console.error("listTournamentBookings error:", err);
    return res.status(500).json({ success: false, message: "Could not load bookings." });
  }
};

// GET /api/admin/overview
// Platform-wide money summary: how much has come in (top-ups + UPI
// booking payments), how much sits in user wallets, and how much
// prize money is still owed out.
exports.getOverview = async (req, res) => {
  try {
    const [topUpAgg] = await Transaction.aggregate([
      { $match: { type: "topup", status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [walletAgg] = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$wallet.balance" } } },
    ]);

    const [prizeAgg] = await Transaction.aggregate([
      { $match: { type: "prize", status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // Booking revenue = entry fees for every PAID booking, whether
    // paid via UPI or wallet — join to the tournament for its fee
    // since Booking itself doesn't store the amount.
    const [revenueAgg] = await Booking.aggregate([
      { $match: { paymentStatus: "paid" } },
      {
        $lookup: {
          from: "tournaments",
          localField: "tournament",
          foreignField: "_id",
          as: "t",
        },
      },
      { $unwind: "$t" },
      { $group: { _id: null, total: { $sum: "$t.entryFee" }, count: { $sum: 1 } } },
    ]);

    const pendingPayouts = await Tournament.find({ "result.payoutStatus": "pending" })
      .select("title prizePool result")
      .sort({ "result.announcedAt": -1 });

    return res.json({
      success: true,
      totalTopUps: topUpAgg?.total || 0,
      totalWalletBalance: walletAgg?.total || 0,
      totalPrizePaidOut: prizeAgg?.total || 0,
      totalBookingRevenue: revenueAgg?.total || 0,
      paidBookingsCount: revenueAgg?.count || 0,
      pendingPayouts,
    });
  } catch (err) {
    console.error("getOverview error:", err);
    return res.status(500).json({ success: false, message: "Could not load overview." });
  }
};

// POST /api/admin/tournaments/:id/payout
// Credits the prize pool to the winning team's wallet. Matches the
// winner by team name against this tournament's bookings — since a
// booking is where teamName -> user actually lives.
exports.payoutPrize = async (req, res) => {
  const { id } = req.params;
  const session = await mongoose.startSession();

  try {
    let tournament, winningBooking, updatedUser;

    await session.withTransaction(async () => {
      tournament = await Tournament.findById(id).session(session);
      if (!tournament) throw new Error("NOT_FOUND");
      if (!tournament.result?.announced) throw new Error("NO_RESULT");
      if (tournament.result.payoutStatus !== "pending") throw new Error("ALREADY_HANDLED");

      winningBooking = await Booking.findOne({
        tournament: id,
        teamName: tournament.result.winnerTeam,
      }).session(session);
      if (!winningBooking) throw new Error("WINNER_NOT_FOUND");

      updatedUser = await User.findByIdAndUpdate(
        winningBooking.user,
        { $inc: { "wallet.balance": tournament.prizePool } },
        { new: true, session }
      );

      await Transaction.create(
        [
          {
            user: winningBooking.user,
            type: "prize",
            amount: tournament.prizePool,
            balanceAfter: updatedUser.wallet.balance,
            status: "success",
          },
        ],
        { session }
      );

      tournament.result.payoutStatus = "paid";
      tournament.result.payoutAt = new Date();
      await tournament.save({ session });
    });

    getIO().to(`user:${winningBooking.user}`).emit("walletUpdated", {
      balance: updatedUser.wallet.balance,
    });

    return res.json({ success: true, tournament });
  } catch (err) {
    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }
    if (err.message === "NO_RESULT") {
      return res.status(400).json({ success: false, message: "Announce a result first." });
    }
    if (err.message === "ALREADY_HANDLED") {
      return res.status(409).json({ success: false, message: "Payout already processed (or nothing to pay)." });
    }
    if (err.message === "WINNER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "No booking matches that team name exactly — check spelling against the bookings list.",
      });
    }
    console.error("payoutPrize error:", err);
    return res.status(500).json({ success: false, message: "Payout failed, please try again." });
  } finally {
    session.endSession();
  }
};
