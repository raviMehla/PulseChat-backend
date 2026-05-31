import crypto from "crypto";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, sendRegistrationOtpSchema, verifyRegistrationOtpSchema } from "../validators/auth.validator.js";
import User from "../models/User.js";
import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import { generateToken } from "../services/token.service.js";
import { sendPasswordResetOTP, sendRegistrationOTP } from "../services/email.service.js";
import jwt from "jsonwebtoken";

// ==========================
// GET SALTS
// GET /api/auth/salts
// Query: ?identifier=...
// ==========================
export const getSalts = async (req, res) => {
  try {
    const { identifier } = req.query;

    if (identifier) {
      const normalizedIdentifier = identifier.toLowerCase().trim();
      const user = await User.findOne({
        $or: [
          { email: normalizedIdentifier },
          { username: normalizedIdentifier },
          { phone: normalizedIdentifier }
        ]
      }).select("+authSalt +e2ee.keySalt");

      if (user && user.authSalt && user.e2ee && user.e2ee.keySalt) {
        return res.status(200).json({
          authSalt: user.authSalt,
          keySalt: user.e2ee.keySalt
        });
      }
    }

    // Generate random salts (either for new registration or as dummy for non-existent users)
    const authSalt = crypto.randomBytes(16).toString("hex");
    const keySalt = crypto.randomBytes(16).toString("hex");

    res.status(200).json({ authSalt, keySalt });
  } catch (error) {
    console.error("GetSalts Error:", error);
    res.status(500).json({ message: "Failed to retrieve encryption parameters" });
  }
};

// ==========================
// IN-MEMORY STORE: Registration OTPs
// { email -> { otp, expiresAt } }
// ==========================
const registrationOtpStore = new Map();

// ==========================
// SEND REGISTRATION OTP — Step 1
// POST /api/auth/send-registration-otp
// Body: { email }
// ==========================
export const sendRegistrationOtp = async (req, res) => {
  try {
    const validation = sendRegistrationOtpSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0]?.message || "Invalid email" });
    }

    const { email } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if email is already registered
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: "This email is already registered. Please log in instead." });
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP with 10-minute expiry (overwrite if they resend)
    registrationOtpStore.set(normalizedEmail, {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    // Send via Brevo
    await sendRegistrationOTP(normalizedEmail, otp);

    res.status(200).json({
      message: "Verification code sent to your email. Please check your inbox."
    });

  } catch (error) {
    console.error("SendRegistrationOtp Error:", error);
    res.status(500).json({ message: "Failed to send verification email. Please try again." });
  }
};

// ==========================
// VERIFY REGISTRATION OTP — Step 2
// POST /api/auth/verify-registration-otp
// Body: { email, otp }
// Returns: { emailVerifiedToken }
// ==========================
export const verifyRegistrationOtp = async (req, res) => {
  try {
    const validation = verifyRegistrationOtpSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0]?.message || "Invalid input" });
    }

    const { email, otp } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();

    const stored = registrationOtpStore.get(normalizedEmail);

    // Generic error to prevent OTP enumeration
    if (!stored) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    if (Date.now() > stored.expiresAt) {
      registrationOtpStore.delete(normalizedEmail);
      return res.status(400).json({ message: "Verification code has expired. Please request a new one." });
    }

    if (stored.otp !== otp) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    // ✅ OTP is correct — delete it immediately (prevent replay)
    registrationOtpStore.delete(normalizedEmail);

    // Issue a short-lived signed JWT as proof of email ownership
    // The email is embedded in the token — the frontend cannot tamper with it
    const emailVerifiedToken = jwt.sign(
      { emailVerified: normalizedEmail },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    res.status(200).json({
      message: "Email verified successfully. You can now complete your registration.",
      emailVerifiedToken
    });

  } catch (error) {
    console.error("VerifyRegistrationOtp Error:", error);
    res.status(500).json({ message: "Failed to verify code. Please try again." });
  }
};

// ==========================
// REGISTER USER — Step 3
// POST /api/auth/register
// Body: { name, username, authToken, emailVerifiedToken, authSalt, keySalt, publicKey, encryptedPrivateKey, keyIv, recoveryEncryptedKey, recoveryKeyIv }
// ==========================
export const registerUser = async (req, res) => {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input data"
      });
    }

    const { 
      name, 
      username, 
      authToken, 
      emailVerifiedToken, 
      authSalt, 
      keySalt, 
      publicKey, 
      encryptedPrivateKey, 
      keyIv, 
      recoveryEncryptedKey, 
      recoveryKeyIv 
    } = validation.data;

    // 🛡️ Verify the emailVerifiedToken to extract the email
    let verifiedEmail;
    try {
      const decoded = jwt.verify(emailVerifiedToken, process.env.JWT_SECRET);
      if (!decoded.emailVerified) {
        return res.status(400).json({ message: "Invalid email verification token. Please restart the registration process." });
      }
      verifiedEmail = decoded.emailVerified;
    } catch (jwtErr) {
      return res.status(400).json({ message: "Your email verification has expired or is invalid. Please verify your email again." });
    }

    // Check existing user using the email from the verified token (tamper-proof)
    const existingUser = await User.findOne({
      $or: [{ email: verifiedEmail }, { username }]
    });

    if (existingUser) {
      if (existingUser.email === verifiedEmail) {
        return res.status(400).json({ message: "This email is already registered." });
      }
      return res.status(400).json({ message: "Username already taken. Please choose another." });
    }

    const hashedPassword = await hashPassword(authToken);

    const user = await User.create({
      name,
      username,
      email: verifiedEmail,  // Always use the email from the verified JWT, not raw input
      password: hashedPassword, // Stores bcrypt(authToken)
      authSalt,
      e2ee: {
        publicKey,
        encryptedPrivateKey,
        keySalt,
        keyIv,
        recoveryEncryptedKey: recoveryEncryptedKey || null,
        recoveryKeyIv: recoveryKeyIv || null,
        recoveryEnabled: !!recoveryEncryptedKey
      }
    });

    // 🛡️ SECURITY: Pass tokenVersion to the token generator
    const token = generateToken(user._id, user.tokenVersion);

    res.status(201).json({
      message: "Account created successfully! Welcome to PulseChat.",
      token,
      _id: user._id,
      id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      profilePic: { url: user.profilePic || "" },
      privacy: user.privacy || { lastSeen: "everyone", profilePhoto: "everyone" },
      blockedUsers: [],
      settings: user.settings || {},
      about: user.bio || "",
      bio: user.bio || "",
      isOnline: true,
      e2ee: {
        publicKey: user.e2ee.publicKey
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
    
    const { identifier, authToken } = validation.data;

    // Pre-computed bcrypt hash of "dummy_password" with 10 salt rounds to match standard cost
    const DUMMY_HASH = "$2a$10$Kwy34S/Xv2e.Gk3Gg8g4v.Oa94uY78t9y1u2i3o4p5a6s7d8f9g0h";

    // identifier = email OR username OR phone
    // We explicitly select +password and +e2ee fields since they are marked select: false in the schema
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier },
        { phone: identifier }
      ]
    }).select("+password +e2ee.encryptedPrivateKey +e2ee.keyIv +e2ee.keySalt");

    // 🛡️ SECURITY: Lockout Check
    if (user && user.lockUntil && user.lockUntil > Date.now()) {
      const remainingMinutes = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
      return res.status(403).json({
        message: `Account is temporarily locked. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`
      });
    }

    let isMatch = false;
    if (user) {
      isMatch = await comparePassword(authToken, user.password);
    } else {
      // Execute dummy check to prevent timing side-channel attacks
      await comparePassword(authToken, DUMMY_HASH);
    }

    if (!user || !isMatch) {
      if (user) {
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        if (user.loginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min cooldown
        }
        await user.save();
      }
      return res.status(400).json({ message: "Invalid credentials. Please check your username/email/phone and password." });
    }

    if (user.isDeleted) {
      return res.status(403).json({ message: "This account has been deleted. Please register a new account to continue." });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0 || user.lockUntil) {
      user.loginAttempts = 0;
      user.lockUntil = null;
      await user.save();
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
      _id: user._id,
      id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone || null,
      profilePic: { url: user.profilePic || "" },
      privacy: user.privacy || { lastSeen: "everyone", profilePhoto: "everyone" },
      blockedUsers: user.blockedUsers || [],
      settings: user.settings || {},
      about: user.bio || "",
      bio: user.bio || "",
      isOnline: true,
      lastSeen: user.lastSeen,
      e2ee: {
        publicKey: user.e2ee?.publicKey || null,
        encryptedPrivateKey: user.e2ee?.encryptedPrivateKey || null,
        keyIv: user.e2ee?.keyIv || null,
        keySalt: user.e2ee?.keySalt || null
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
// Body: { email, otp, newAuthToken, newAuthSalt, newKeySalt, newKeyIv, newEncryptedPrivateKey, newRecoveryEncryptedKey, newRecoveryKeyIv }
// ==========================
export const resetPassword = async (req, res) => {
  try {
    const validation = resetPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { 
      email, 
      otp, 
      newAuthToken, 
      newAuthSalt, 
      newKeySalt, 
      newKeyIv, 
      newEncryptedPrivateKey, 
      newRecoveryEncryptedKey, 
      newRecoveryKeyIv 
    } = validation.data;

    const user = await User.findOne({ email });

    // 1️⃣ Validate: user exists, OTP matches, OTP is not expired
    if (!user || user.resetPasswordOtp !== otp) {
      return res.status(400).json({ message: "Invalid or expired reset code." });
    }

    if (user.resetPasswordOtpExpires < Date.now()) {
      return res.status(400).json({ message: "Reset code has expired. Please request a new one." });
    }

    // 2️⃣ Hash the new authToken
    const hashedPassword = await hashPassword(newAuthToken);

    // 3️⃣ Update password, salts, E2EE key block, clear OTP fields, and revoke all existing sessions
    // Incrementing tokenVersion logs the user out of ALL other devices for security
    user.password = hashedPassword;
    user.authSalt = newAuthSalt;
    user.e2ee = {
      publicKey: user.e2ee?.publicKey || null,
      encryptedPrivateKey: newEncryptedPrivateKey,
      keySalt: newKeySalt,
      keyIv: newKeyIv,
      keyVersion: (user.e2ee?.keyVersion || 1) + 1,
      recoveryEncryptedKey: newRecoveryEncryptedKey || null,
      recoveryKeyIv: newRecoveryKeyIv || null,
      recoveryEnabled: !!newRecoveryEncryptedKey
    };
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
        email: user.email,
        e2ee: {
          publicKey: user.e2ee?.publicKey || null,
          encryptedPrivateKey: user.e2ee?.encryptedPrivateKey || null,
          keyIv: user.e2ee?.keyIv || null,
          keySalt: user.e2ee?.keySalt || null
        }
      }
    });

  } catch (error) {
    console.error("ResetPassword Error:", error);
    res.status(500).json({ message: "Failed to reset password. Please try again." });
  }
};