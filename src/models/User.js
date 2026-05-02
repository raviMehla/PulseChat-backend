import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      unique: true,
      sparse: true
    },
    password: {
      type: String,
      required: true
    },
    // 🔥 Cleaned up avatar vs profilePic redundancy
    profilePic: {
      type: String,
      default: ""
    },
    bio: {
      type: String,
      default: ""
    },
    // 🔥 ARCHITECTURE RULE: Array of tokens for Web + Mobile + Tablet multi-login
    fcmTokens: { 
      type: [String], 
      default: [] 
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    isOnline: {
      type: Boolean,
      default: false
    },
    lastSeen: {
      type: Date,
      default: Date.now
    },
    privacy: {
      lastSeen: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone"
      },
      profilePhoto: {
        type: String,
        enum: ["everyone", "contacts", "nobody"],
        default: "everyone"
      }
    }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;