import express from "express";
import { registerUser, loginUser, forgotPassword, resetPassword } from "../controllers/auth.controller.js";
import { authLimiter } from "../middleware/rateLimit.middleware.js";

const router = express.Router();

router.post("/login", authLimiter, loginUser);
router.post("/register", authLimiter, registerUser);

// ── Forgot Password Flow (no auth required — pre-login) ──
// authLimiter prevents OTP brute-force attacks
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);

export default router;
