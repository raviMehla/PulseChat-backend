import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true },

    // 🔥 Root Data Fields
    profilePic: { type: String, default: "" },
    bio: { type: String, maxLength: [150, "Bio cannot exceed 150 characters"], default: "" },
    
    // 🟢 Phase 1: Settings
    settings: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      notificationsEnabled: { type: Boolean, default: true },
    },

    // 🔥 Multi-Device Push Notifications
    fcmTokens: { type: [String], default: [] },
    deviceToken: { type: String, default: null },

    // 🔥 Status Metrics
    twoFactorEnabled: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },

    // 🟢 Phase 2: Privacy Boundaries
    privacy: {
      lastSeen: { type: String, enum: ["everyone", "contacts", "nobody"], default: "everyone" },
      profilePhoto: { type: String, enum: ["everyone", "contacts", "nobody"], default: "everyone" }
    },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // 🟢 Phase 3: Session Security (Token Invalidation)
    tokenVersion: { type: Number, default: 0 },

    // 🟢 Phase 4: Account Deletion Pipeline
    deletionOtp: { type: String, default: null },
    deletionOtpExpires: { type: Date, default: null }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;