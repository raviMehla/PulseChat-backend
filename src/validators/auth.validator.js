import { z } from "zod";

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
const passwordValidator = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(passwordRegex, "Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character (!@#$%^&*)");

export const loginSchema = z.object({
  identifier: z.string().min(1, "Identifier required"),
  password: z.string().min(1, "Password is required")
});

// ── Registration OTP: Step 1 — Send OTP to email ──
export const sendRegistrationOtpSchema = z.object({
  email: z.string().email("A valid email address is required")
});

// ── Registration OTP: Step 2 — Verify OTP ──
export const verifyRegistrationOtpSchema = z.object({
  email: z.string().email("A valid email address is required"),
  otp: z.string().length(6, "OTP must be exactly 6 digits")
});

// ── Registration: Step 3 — Create Account (requires emailVerifiedToken) ──
export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: passwordValidator,
  emailVerifiedToken: z.string().min(1, "Email verification is required. Please verify your email first.")
});

// ── Forgot Password: Step 1 — Request OTP ──
export const forgotPasswordSchema = z.object({
  email: z.string().email("A valid email address is required")
});

// ── Forgot Password: Step 2 — Verify OTP & Set New Password ──
export const resetPasswordSchema = z.object({
  email: z.string().email("A valid email address is required"),
  otp: z.string().length(6, "OTP must be exactly 6 digits"),
  newPassword: passwordValidator
});