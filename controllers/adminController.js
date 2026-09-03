const Tournament = require("../models/Tournament");
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
// Sets the room ID/password. isRevealed stays false — the cron job
// (jobs/roomReveal.js) flips it automatically 10 min before schedule.
// Admin can also force-reveal immediately by passing revealNow: true.
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

