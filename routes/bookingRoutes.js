const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getMyBookings, cancelBooking } = require("../controllers/bookingController");

router.get("/me", protect, getMyBookings);
router.delete("/:bookingId", protect, cancelBooking);

module.exports = router;
