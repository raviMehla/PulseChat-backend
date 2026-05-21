import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().min(1, "Identifier required"),
  password: z.string().min(6, "Password must be at least 6 characters")
});

export const registerSchema = z.object({
  name: z.string().min(2),
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6)
});

// ── Forgot Password: Step 1 — Request OTP ──
export const forgotPasswordSchema = z.object({
  email: z.string().email("A valid email address is required")
});

// ── Forgot Password: Step 2 — Verify OTP & Set New Password ──
export const resetPasswordSchema = z.object({
  email: z.string().email("A valid email address is required"),
  otp: z.string().length(6, "OTP must be exactly 6 digits"),
  newPassword: z.string().min(6, "New password must be at least 6 characters")
});