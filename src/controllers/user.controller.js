import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { sendDeletionOTP } from "../services/email.service.js"; // 🟢 Genuine SMTP Service

import { 
  searchUserSchema, 
  fcmTokenSchema, 
  updateProfileSchema, 
  updatePasswordSchema, 
  updatePrivacySchema,
  deviceTokenSchema,
  deleteAccountSchema 
} from "../validators/user.validator.js";
import { hashPassword, comparePassword } from "../utils/hashPassword.js";
import { generateToken } from "../services/token.service.js";


// =====================================
// GET USER PROFILE
// =====================================
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    
    res.status(200).json(user);
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
// UPDATE PROFILE (Name, Bio, Settings)
// =====================================
export const updateProfile = async (req, res) => {
  try {
    // 🛡️ ARCHITECTURAL FIX: Strict Zod Validation
    const validation = updateProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.errors[0].message });
    }

    const { name, bio, settings } = validation.data;
    
    // Use $set to dynamically update only provided fields without overwriting others
    const updatePayload = {};
    if (name) updatePayload.name = name;
    if (bio) updatePayload.bio = bio;
    if (settings) updatePayload.settings = settings;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).select("-password");

    res.status(200).json({ message: "Profile updated", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// UPDATE PROFILE PICTURE
// =====================================
export const updateProfilePic = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePic: req.file.path },
      { new: true }
    ).select("-password");

    res.status(200).json({
      message: "Profile picture updated",
      profilePic: user.profilePic
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
      return res.status(400).json({ message: validation.error.errors[0].message });
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
      return res.status(400).json({ message: validation.error.errors[0].message });
    }

    const { currentPassword, newPassword } = validation.data;
    const user = await User.findById(req.user._id);

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password" });
    }

    user.password = await hashPassword(newPassword);
    
    // 🛡️ SECURITY: Increment tokenVersion to kill all old sessions on other devices
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

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
    // Incrementing tokenVersion invalidates all existing JWTs globally
    await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
    res.status(200).json({ message: "Successfully logged out of all devices." });
  } catch (error) {
    res.status(500).json({ message: "Failed to revoke sessions", error: error.message });
  }
};

// =====================================
// TOGGLE BLOCK USER
// =====================================
export const toggleBlockUser = async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const currentUserId = req.user._id;

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
    const validation = searchUserSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const keyword = validation.data.search;

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { name: { $regex: keyword, $options: "i" } },
        { email: { $regex: keyword, $options: "i" } },
        { username: { $regex: keyword, $options: "i" } }
      ]
    }).select("-password").limit(20);

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Internal server error during user search" });
  }
};

// =====================================
// REGISTER DEVICE / FCM TOKENS
// =====================================  
export const saveDeviceToken = async (req, res) => {
  try {
    const validation = deviceTokenSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    await User.findByIdAndUpdate(req.user._id, { deviceToken: validation.data.token });
    res.status(200).json({ message: "Device token saved" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

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

// =====================================
// EXPORT USER DATA (BACKUP PIPELINE)
// =====================================
export const exportUserData = async (req, res) => {
  try {
    const userId = req.user._id;

    // Run aggregations concurrently for performance
    const [profile, chats, messages] = await Promise.all([
      User.findById(userId).select("-password -fcmTokens -deviceToken"),
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
      return res.status(400).json({ message: validation.error.errors[0].message });
    }

    const { password, otp } = validation.data;
    const user = await User.findById(req.user._id);

    // 2️⃣ Verify Password & OTP
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) return res.status(403).json({ message: "Invalid password" });

    if (user.deletionOtp !== otp || user.deletionOtpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // 3️⃣ Safe Wipe Pipeline
    const userId = user._id;

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

    res.status(200).json({ message: "Account has been permanently deleted." });
  } catch (error) {
    console.error("Account Deletion Error:", error);
    res.status(500).json({ message: "Fatal error during account deletion" });
  }
};