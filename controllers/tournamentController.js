const Tournament = require("../models/Tournament");

// GET /api/tournaments?status=upcoming
exports.listTournaments = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const tournaments = await Tournament.find(filter).sort({ schedule: 1 });
    return res.json({ success: true, tournaments });
  } catch (err) {
    console.error("listTournaments error:", err);
    return res.status(500).json({ success: false, message: "Could not load tournaments." });
  }
};

// GET /api/tournaments/:id
exports.getTournamentById = async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ success: false, message: "Tournament not found." });
    }
    return res.json({ success: true, tournament });
  } catch (err) {
    console.error("getTournamentById error:", err);
    return res.status(500).json({ success: false, message: "Could not load tournament." });
  }
};
