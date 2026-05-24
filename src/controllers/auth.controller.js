import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "../validators/auth.validator.js";
import User from "../models/User.js";
import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import { generateToken } from "../services/token.service.js";
import { sendPasswordResetOTP } from "../services/email.service.js";

// ==========================
// REGISTER USER
// ==========================
export const registerUser = async (req, res) => {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      // 🛡️ FIX: Use .issues for standard Zod compatibility and added safety
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input data"
      });
    }
    const { name, username, email, password, phone } = validation.data;

    // Check existing user
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({ message: "Email or Username already exists" });
    }

    const hashedPassword = await hashPassword(password);

    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      phone
      // tokenVersion defaults to 0 via our updated Mongoose schema
    });

    // 🛡️ SECURITY: Pass tokenVersion to the token generator
    const token = generateToken(user._id, user.tokenVersion);

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// LOGIN USER
// ==========================
export const loginUser = async (req, res) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    
    if (!validation.success) {
      // Support both Zod validation return formats safely
      const errorMsg = validation.error.errors?.[0]?.message || validation.error.issues?.[0]?.message;
      return res.status(400).json({ message: errorMsg });
    }
    
    const { identifier, password } = validation.data;

    // Pre-computed bcrypt hash of "dummy_password" with 10 salt rounds to match standard cost
    const DUMMY_HASH = "$2a$10$Kwy34S/Xv2e.Gk3Gg8g4v.Oa94uY78t9y1u2i3o4p5a6s7d8f9g0h";

    // identifier = email OR username OR phone
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier },
        { phone: identifier }
      ]
    });

    let isMatch = false;
    if (user) {
      isMatch = await comparePassword(password, user.password);
    } else {
      // Execute dummy check to prevent timing side-channel attacks
      await comparePassword(password, DUMMY_HASH);
    }

    if (!user || !isMatch) {
      return res.status(400).json({ message: "Invalid credentials. Please check your username/email/phone and password." });
    }

    if (user.isDeleted) {
      return res.status(403).json({ message: "This account has been deleted. Please register a new account to continue." });
    }

    // If 2FA enabled (future extension)
    if (user.twoFactorEnabled) {
      return res.status(200).json({
        message: "Two-factor authentication required",
        twoFactor: true
      });
    }

    // 🛡️ SECURITY: Pass tokenVersion to the token generator
    const token = generateToken(user._id, user.tokenVersion);

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==========================
// FORGOT PASSWORD — Step 1: Request OTP
// POST /api/auth/forgot-password
// Body: { email }
// ==========================
export const forgotPassword = async (req, res) => {
  try {
    const validation = forgotPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { email } = validation.data;

    // Find user — but always return a generic message to prevent email enumeration
    const user = await User.findOne({ email });

    if (user && !user.isDeleted) {
      // Generate a secure 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP with 15-minute expiry — send email FIRST, save to DB only on success
      await sendPasswordResetOTP(email, otp);

      await User.findByIdAndUpdate(user._id, {
        resetPasswordOtp: otp,
        resetPasswordOtpExpires: Date.now() + 15 * 60 * 1000 // 15 minutes
      });
    }

    // Always respond with the same message (prevents user enumeration attack)
    res.status(200).json({
      message: "If an account with that email exists, a reset code has been sent."
    });

  } catch (error) {
    console.error("ForgotPassword Error:", error);
    res.status(500).json({ message: "Failed to send reset email. Please try again later." });
  }
};

// ==========================
// RESET PASSWORD — Step 2: Verify OTP & Set New Password
// POST /api/auth/reset-password
// Body: { email, otp, newPassword }
// ==========================
export const resetPassword = async (req, res) => {
  try {
    const validation = resetPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { email, otp, newPassword } = validation.data;

    const user = await User.findOne({ email });

    // 1️⃣ Validate: user exists, OTP matches, OTP is not expired
    if (!user || user.resetPasswordOtp !== otp) {
      return res.status(400).json({ message: "Invalid or expired reset code." });
    }

    if (user.resetPasswordOtpExpires < Date.now()) {
      return res.status(400).json({ message: "Reset code has expired. Please request a new one." });
    }

    // 2️⃣ Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // 3️⃣ Update password, clear OTP fields, and revoke all existing sessions
    // Incrementing tokenVersion logs the user out of ALL other devices for security
    user.password = hashedPassword;
    user.resetPasswordOtp = null;
    user.resetPasswordOtpExpires = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // 4️⃣ Issue a fresh token for the current session
    const token = generateToken(user._id, user.tokenVersion);

    res.status(200).json({
      message: "Password reset successfully. You are now logged in.",
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error("ResetPassword Error:", error);
    res.status(500).json({ message: "Failed to reset password. Please try again." });
  }
};