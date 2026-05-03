import { loginSchema, registerSchema } from "../validators/auth.validator.js";
import User from "../models/User.js";
import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import { generateToken } from "../services/token.service.js";

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
      return res.status(400).json({
        message: validation.error.errors[0].message
      });
    }
    const { identifier, password } = validation.data;

    // identifier = email OR username OR phone
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier },
        { phone: identifier }
      ]
    });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
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