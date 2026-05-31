import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { sendDeletionOTP, sendInvitationEmail } from "../services/email.service.js"; // 🟢 Genuine SMTP Service
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";
import { getIO } from "../socket.js";

// Helper to extract Cloudinary public ID from URL
const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/upload/");
    if (parts.length < 2) return null;
    let path = parts[1];
    const versionMatch = path.match(/^v\d+\/(.+)$/);
    if (versionMatch) {
      path = versionMatch[1];
    }
    const dotIndex = path.lastIndexOf(".");
    if (dotIndex !== -1) {
      path = path.substring(0, dotIndex);
    }
    return path;
  } catch (error) {
    console.error("Failed to parse public_id from URL:", url, error);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// CLOUDINARY UPLOAD HELPER (Buffer → Cloud URL)
// Reusable for profile pics and any future binary uploads
// ─────────────────────────────────────────────────────────────
const uploadBufferToCloudinary = (buffer, folder = "pulsechat/avatars") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

import { 
  searchUserSchema, 
  fcmTokenSchema, 
  updateProfileSchema, 
  updatePasswordSchema, 
  updatePrivacySchema,
  deleteAccountSchema 
} from "../validators/user.validator.js";
import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import { generateToken } from "../services/token.service.js";

// ─────────────────────────────────────────────────────────────
// NORMALIZE USER HELPER
// Transforms a Mongoose user document into a safe API response.
// Converts profilePic (stored as plain URL string) → { url } object
// so the mobile APK's profilePic?.url pattern works everywhere.
// ─────────────────────────────────────────────────────────────
const normalizeUser = (userDoc) => {
  const obj = typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };
  if (obj.profilePic && typeof obj.profilePic === "string") {
    obj.profilePic = { url: obj.profilePic };
  } else if (!obj.profilePic) {
    obj.profilePic = { url: "" };
  }
  return obj;
};

// =====================================
// GET USER PROFILE
// =====================================
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password").populate("blockedUsers", "_id name username profilePic");
    if (!user) return res.status(404).json({ message: "User not found" });
    
    res.status(200).json(normalizeUser(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// GET USER STATUS (Online/Last Seen)
// =====================================
export const getUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("isOnline lastSeen");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =====================================
// UNIFIED PROFILE UPDATE (Text + Avatar)
// =====================================
export const updateProfile = async (req, res) => {
  try {
    // 1️⃣ Strict Zod Validation (multer has already parsed the text fields into req.body)
    const validation = updateProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0]?.message });
    }

    const { name, bio, about, phone, settings } = validation.data;
    const updatePayload = Object.create(null);
    const unsetPayload = Object.create(null);

    // 2️⃣ Map validated text fields
    if (name) updatePayload.name = name;
    // Accept 'bio' (web) or 'about' (mobile APK) — both map to the same DB field
    if (bio !== undefined) updatePayload.bio = bio;
    else if (about !== undefined) updatePayload.bio = about;
    
    if (phone !== undefined) {
      if (phone === null || phone.trim() === "") {
        unsetPayload.phone = "";
      } else {
        const trimmedPhone = phone.trim();
        const existingPhoneUser = await User.findOne({ phone: trimmedPhone, _id: { $ne: req.user._id } });
        if (existingPhoneUser) {
          return res.status(400).json({ message: "Phone number is already in use by another account" });
        }
        updatePayload.phone = trimmedPhone;
      }
    }

    if (settings) {
      if (settings.theme) updatePayload["settings.theme"] = settings.theme;
      if (settings.notificationsEnabled !== undefined) {
        updatePayload["settings.notificationsEnabled"] = settings.notificationsEnabled;
      }
    }


    // 3️⃣ File Handling — stream buffer to Cloudinary (memoryStorage has no .path)
    if (req.file) {
      // Fetch existing user to check if they already have an avatar
      const existingUser = await User.findById(req.user._id).select("profilePic");
      if (existingUser && existingUser.profilePic) {
        const oldPublicId = getPublicIdFromUrl(existingUser.profilePic);
        if (oldPublicId) {
          // Asynchronously delete the old asset in the background
          cloudinary.uploader.destroy(oldPublicId)
            .catch(err => console.error("Failed to delete old avatar from Cloudinary:", err));
        }
      }

      const result = await uploadBufferToCloudinary(req.file.buffer, "pulsechat/avatars");
      updatePayload.profilePic = result.secure_url;
    }

    // 4️⃣ Database Execution
    const updateQuery = {};
    if (Object.keys(updatePayload).length > 0) updateQuery.$set = updatePayload;
    if (Object.keys(unsetPayload).length > 0) updateQuery.$unset = unsetPayload;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateQuery,
      { returnDocument: "after", runValidators: true }
    ).select("-password").populate("blockedUsers", "_id name username profilePic");

    // 🛡️ LEVEL 5 FIX: Real-Time Identity Sync Broadcasts
    try {
      const associatedChats = await Chat.find({ users: req.user._id }).select("_id");
      const io = getIO();
      associatedChats.forEach(chat => {
        io.to(String(chat._id)).emit("user_profile_updated", {
          userId: req.user._id,
          name: user.name,
          profilePic: user.profilePic ? { url: user.profilePic } : { url: "" },
          bio: user.bio
        });
      });
    } catch (err) {
      console.error("Failed to broadcast profile update:", err);
    }

    res.status(200).json({ 
      message: "Profile updated successfully", 
      user: normalizeUser(user)
    });
  } catch (error) {
    console.error("Unified Profile Update Error:", error);
    res.status(500).json({ message: "Failed to update profile", error: error.message });
  }
};
// =====================================
// UPDATE PRIVACY
// =====================================
export const updatePrivacy = async (req, res) => {
  try {
    // 🛡️ ARCHITECTURAL FIX: Strict Zod Validation
    const validation = updatePrivacySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0]?.message });
    }

    const { lastSeen, profilePhoto } = validation.data;
    const user = await User.findById(req.user._id);

    // Initialize privacy object if it doesn't exist to prevent crashes
    if (!user.privacy) user.privacy = {};
    
    if (lastSeen) user.privacy.lastSeen = lastSeen;
    if (profilePhoto) user.privacy.profilePhoto = profilePhoto;

    await user.save();

    res.status(200).json({ message: "Privacy updated", privacy: user.privacy });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// UPDATE PASSWORD (REVOKES SESSIONS)
// =====================================
export const updatePassword = async (req, res) => {
  try {
    const validation = updatePasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0]?.message });
    }

    const { 
      currentAuthToken, 
      newAuthToken, 
      newAuthSalt, 
      newKeySalt, 
      newKeyIv, 
      newEncryptedPrivateKey, 
      newRecoveryEncryptedKey, 
      newRecoveryKeyIv 
    } = validation.data;
    
    const user = await User.findById(req.user._id);

    const isMatch = await comparePassword(currentAuthToken, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password" });
    }

    user.password = await hashPassword(newAuthToken);
    user.authSalt = newAuthSalt;
    user.e2ee = {
      publicKey: user.e2ee.publicKey,
      encryptedPrivateKey: newEncryptedPrivateKey,
      keySalt: newKeySalt,
      keyIv: newKeyIv,
      keyVersion: (user.e2ee.keyVersion || 1) + 1,
      recoveryEncryptedKey: newRecoveryEncryptedKey || null,
      recoveryKeyIv: newRecoveryKeyIv || null,
      recoveryEnabled: !!newRecoveryEncryptedKey
    };
    
    // 🛡️ SECURITY: Increment tokenVersion to kill all old sessions on other devices
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.fcmTokens = []; // 👈 CRITICAL FIX: Changing password must stop push notifications to old devices
    await user.save();

    // 🛡️ LEVEL 3 FIX: Evict all active stateful websocket connections for this user
    try {
      const io = getIO();
      io.to(String(user._id)).disconnectSockets(true);
    } catch (err) {
      console.error("Socket eviction failed on password update:", err);
    }

    // Generate a new token for the current device
    const newToken = generateToken(user._id, user.tokenVersion);

    res.status(200).json({ 
      message: "Password updated successfully. Other devices have been logged out.",
      token: newToken 
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to update password", error: error.message });
  }
};

// =====================================
// LOGOUT ALL DEVICES
// =====================================
export const logoutAllDevices = async (req, res) => {
  try {
    // Incrementing tokenVersion invalidates all existing JWTs globally, and wipes FCM tokens
    await User.findByIdAndUpdate(req.user._id, { 
      $inc: { tokenVersion: 1 },
      $set: { fcmTokens: [] }
    });

    // 🛡️ LEVEL 3 FIX: Evict all active stateful websocket connections for this user
    try {
      const io = getIO();
      io.to(String(req.user._id)).disconnectSockets(true);
    } catch (err) {
      console.error("Socket eviction failed on logout:", err);
    }

    res.status(200).json({ message: "Successfully logged out of all devices and revoked push access." });
  } catch (error) {
    res.status(500).json({ message: "Failed to revoke sessions", error: error.message });
  }
};

// =====================================
// TOGGLE BLOCK USER
// =====================================
export const toggleBlockUser = async (req, res) => {
  try {
    // Support both URL param (web frontend) and request body (mobile APK)
    const targetUserId = req.params.targetUserId || req.body.targetUserId;
    const currentUserId = req.user._id;

    if (!targetUserId) {
      return res.status(400).json({ message: "targetUserId is required." });
    }

    if (String(targetUserId) === String(currentUserId)) {
      return res.status(400).json({ message: "You cannot block yourself." });
    }

    const user = await User.findById(currentUserId);
    const isBlocked = user.blockedUsers.includes(targetUserId);

    if (isBlocked) {
      user.blockedUsers.pull(targetUserId); // Unblock
      await user.save();
      return res.status(200).json({ message: "User unblocked successfully", blocked: false });
    } else {
      user.blockedUsers.addToSet(targetUserId); // Block
      await user.save();
      return res.status(200).json({ message: "User blocked successfully", blocked: true });
    }
  } catch (error) {
    res.status(500).json({ message: "Failed to toggle block status", error: error.message });
  }
};

// =====================================
// SEARCH USERS
// =====================================
export const searchUsers = async (req, res) => {
  try {
    // 1️⃣ Strict Zod Validation
    const validation = searchUserSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const keyword = validation.data.search;

    // 2️⃣ Multi-Field Search Execution
    const users = await User.find({
      _id: { $ne: req.user._id }, // Never return the current user in search results
      $or: [
        { name: { $regex: keyword, $options: "i" } },
        { email: { $regex: keyword, $options: "i" } },
        { username: { $regex: keyword, $options: "i" } },
        { phone: { $regex: keyword, $options: "i" } } // 📱 Added Phone support per architectural requirements
      ]
    }).select("-password").limit(20); // Cap at 20 to protect memory/bandwidth

    // Normalize profilePic to { url } format for mobile APK compatibility
    res.status(200).json(users.map(normalizeUser));
  } catch (error) {
    console.error("User Search Error:", error);
    res.status(500).json({ message: "Internal server error during user search" });
  }
};

// =====================================
// =====================================
// REGISTER DEVICE / FCM TOKENS
// =====================================  
export const registerFcmToken = async (req, res) => {
  try {
    const validation = fcmTokenSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { fcmTokens: validation.data.token } }
    );

    res.status(200).json({ message: "FCM Token registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};

export const removeFcmToken = async (req, res) => {
  try {
    const validation = fcmTokenSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { fcmTokens: validation.data.token } }
    );

    res.status(200).json({ message: "Device unregistered from push notifications successfully" });
  } catch (error) {
    console.error("Remove FCM Token Error:", error);
    res.status(500).json({ message: "Failed to remove push notification token" });
  }
};

// =====================================
// EXPORT USER DATA (BACKUP PIPELINE)
// =====================================
export const exportUserData = async (req, res) => {
  try {
    const userId = req.user._id;

    // Run aggregations concurrently for performance
    const [profile, chats, messages] = await Promise.all([
      User.findById(userId).select("-password -fcmTokens"),
      Chat.find({ users: userId }).select("chatName isGroup createdAt"),
      Message.find({ sender: userId }).select("content messageType createdAt")
    ]);

    const backupPayload = {
      generatedAt: new Date().toISOString(),
      user: profile,
      totalChats: chats.length,
      totalMessagesSent: messages.length,
      chatMetadata: chats,
      messageHistory: messages
    };

    // Return as JSON. The frontend will convert this to a downloadable file.
    res.status(200).json(backupPayload);
  } catch (error) {
    console.error("Data Export Error:", error);
    res.status(500).json({ message: "Failed to generate data backup" });
  }
};

// =====================================
// INITIATE ACCOUNT DELETION (OTP)
// =====================================
export const requestDeleteOtp = async (req, res) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email; 
    
    // 1️⃣ Generate a secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 2️⃣ Attempt to send the email FIRST
    // If this fails, it throws an error and jumps to the catch block
    await sendDeletionOTP(userEmail, otp);

    // 3️⃣ Only save to DB if the email was successfully dispatched
    await User.findByIdAndUpdate(userId, { 
      deletionOtp: otp, 
      deletionOtpExpires: Date.now() + 15 * 60 * 1000 // 15 mins
    });

    res.status(200).json({ message: "Verification code sent to your email." });
  } catch (error) {
    console.error("OTP Request Error:", error);
    res.status(500).json({ message: "Failed to dispatch verification email. Please try again later." });
  }
};

// =====================================
// EXECUTE ACCOUNT DELETION
// =====================================
export const deleteAccount = async (req, res) => {
  try {
    // 1️⃣ Strict Zod Validation
    const validation = deleteAccountSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0]?.message });
    }

    const { authToken, otp } = validation.data;
    const user = await User.findById(req.user._id);

    // 2️⃣ Verify Password & OTP
    const isMatch = await comparePassword(authToken, user.password);
    if (!isMatch) return res.status(403).json({ message: "Invalid password" });

    if (user.deletionOtp !== otp || user.deletionOtpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // 3️⃣ Safe Wipe Pipeline
    const userId = user._id;

    // 🛡️ LEVEL 3 FIX: Delete avatar from Cloudinary if it exists
    if (user.profilePic) {
      const publicId = getPublicIdFromUrl(user.profilePic);
      if (publicId) {
        cloudinary.uploader.destroy(publicId)
          .catch(err => console.error("Failed to delete profile pic from Cloudinary during account deletion:", err));
      }
    }

    // Remove user from all chats
    await Chat.updateMany(
      { users: userId },
      { $pull: { users: userId } }
    );

    // Optional: Anonymize their messages instead of deleting to preserve group chat context
    await Message.updateMany(
      { sender: userId },
      { $set: { isDeleted: true, content: "Account Deleted" } }
    );

    // Finally, delete the user document
    await User.findByIdAndDelete(userId);

    // 🛡️ LEVEL 3 FIX: Evict all active stateful websocket connections for this user room
    try {
      const io = getIO();
      io.to(String(userId)).disconnectSockets(true);
    } catch (err) {
      console.error("Socket eviction failed on account deletion:", err);
    }

    res.status(200).json({ message: "Account has been permanently deleted." });
  } catch (error) {
    console.error("Account Deletion Error:", error);
    res.status(500).json({ message: "Fatal error during account deletion" });
  }
};

// =====================================
// INVITE USER
// =====================================
export const inviteUser = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    // Check if the user is already signed up
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: "This user is already signed up on PulseChat" });
    }

    // Send the email invitation
    const inviterName = req.user.name || req.user.username;
    await sendInvitationEmail(email.toLowerCase(), inviterName);

    res.status(200).json({ message: "Invitation sent successfully" });
  } catch (error) {
    console.error("Invite User Error:", error);
    res.status(500).json({ message: "Failed to send invitation", error: error.message });
  }
};

// =====================================
// GET USER PUBLIC KEY
// =====================================
export const getUserPublicKey = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("e2ee.publicKey");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ publicKey: user.e2ee?.publicKey || null });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch user public key", error: error.message });
  }
};

// =====================================
// GET USER BACKUP (For current user)
// =====================================
export const getUserBackup = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "+e2ee.encryptedPrivateKey +e2ee.keyIv +e2ee.keySalt"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({
      encryptedPrivateKey: user.e2ee?.encryptedPrivateKey || null,
      keyIv: user.e2ee?.keyIv || null,
      keySalt: user.e2ee?.keySalt || null
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch backup keys", error: error.message });
  }
};