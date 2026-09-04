const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { listTournaments, getTournamentById } = require("../controllers/tournamentController");
const { bookSlot } = require("../controllers/bookingController");
const { bookWithWallet } = require("../controllers/walletController");

// Public
router.get("/", listTournaments);
router.get("/:id", getTournamentById);

// Requires login
router.post("/:tournamentId/book", protect, bookSlot);
router.post("/:tournamentId/book-with-wallet", protect, bookWithWallet);

module.exports = router;
