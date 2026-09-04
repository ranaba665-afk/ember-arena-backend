const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "30d" });

exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, gameId, ign } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required." });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const hashed = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      // Empty string would still hit the unique index (MongoDB treats
      // "" as a real value, not "no value"), so the second user who
      // leaves phone blank gets a duplicate-key error. Normalizing to
      // undefined lets the sparse index skip it entirely, the way an
      // omitted optional field should behave.
      phone: phone || undefined,
      password: hashed,
      gameId,
      ign,
    });

    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ success: false, message: "Registration failed, please try again." });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    // password has `select: false` in the schema, so it must be explicitly requested
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return res.status(401).json({ success: false, message: "Incorrect email or password." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Incorrect email or password." });
    }

    const token = signToken(user._id);

    return res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ success: false, message: "Login failed, please try again." });
  }
};
