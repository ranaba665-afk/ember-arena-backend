const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  createTournament,
  updateTournament,
  setRoomDetails,
  announceResult,
  listTournamentBookings,
  getOverview,
  payoutPrize,
} = require("../controllers/adminController");

// Every route below requires a valid JWT AND role === "admin"
router.use(protect, adminOnly);

router.post("/tournaments", createTournament);
router.put("/tournaments/:id", updateTournament);
router.patch("/tournaments/:id/room", setRoomDetails);
router.patch("/tournaments/:id/result", announceResult);
router.get("/tournaments/:id/bookings", listTournamentBookings);
router.post("/tournaments/:id/payout", payoutPrize);
router.get("/overview", getOverview);

module.exports = router;
