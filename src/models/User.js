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
    deletionOtpExpires: { type: Date, default: null },

    // 🟢 Forgot Password Pipeline
    resetPasswordOtp: { type: String, default: null },
    resetPasswordOtpExpires: { type: Date, default: null },

    // 🛡️ SECURITY: Lockout Pipeline
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null }
  },
  {
    timestamps: true,
    // ─────────────────────────────────────────────────────────────
    // toJSON TRANSFORM: Automatically normalizes every user document
    // when serialized as JSON (res.json(), JSON.stringify(), populate)
    //
    // KEY CHANGE: profilePic stored as plain URL string in DB, but
    // mobile APK expects { url: string } object format everywhere.
    // This transform fires on EVERY JSON response — including populated
    // chat.users, message.sender, search results — so no controller
    // needs a manual fix.
    // ─────────────────────────────────────────────────────────────
    toJSON: {
      transform: (_doc, ret) => {
        // Normalize profilePic: string → { url }
        if (typeof ret.profilePic === "string") {
          ret.profilePic = { url: ret.profilePic };
        } else if (!ret.profilePic) {
          ret.profilePic = { url: "" };
        }

        // Expose _id as both _id and id for frontend compatibility
        ret.id = ret._id;

        // Remove sensitive server-only fields from all API responses
        delete ret.password;
        delete ret.tokenVersion;
        delete ret.deletionOtp;
        delete ret.deletionOtpExpires;
        delete ret.resetPasswordOtp;
        delete ret.resetPasswordOtpExpires;
        delete ret.loginAttempts;
        delete ret.lockUntil;
        delete ret.fcmTokens;

        return ret;
      }
    }
  }
);

const User = mongoose.model("User", userSchema);

export default User;