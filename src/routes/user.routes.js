import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

import {
  getProfile,
  updateProfile,  
  updatePrivacy,
  updatePassword,
  logoutAllDevices,
  toggleBlockUser,
  getUserStatus,
  searchUsers,
  saveDeviceToken,
  registerFcmToken,
  exportUserData, requestDeleteOtp, deleteAccount
} from "../controllers/user.controller.js";

const router = express.Router();

// ==========================================
// GLOBAL MIDDLEWARE
// ==========================================
// Enforce authentication for ALL routes in this file
router.use(protect);

// ==========================================
// PROFILE MANAGEMENT
// ==========================================
// 🛡️ ARCHITECTURAL UPGRADE: Unified route handles text and file simultaneously
router.get("/profile", getProfile);
router.put("/profile", upload.single("profilePic"), updateProfile);

// ==========================================
// PRIVACY & SECURITY (Phase 2 & 3)
// ==========================================
router.put("/privacy", updatePrivacy);
router.put("/password", updatePassword);
router.post("/logout-all", logoutAllDevices);
router.put("/block/:targetUserId", toggleBlockUser);

// ==========================================
// USER DISCOVERY & STATUS
// ==========================================
// Note: Put /search before /status/:id so Express doesn't treat "search" as an ID
router.get("/search", searchUsers);
router.get("/status/:id", getUserStatus);

// ==========================================
// DEVICE & PUSH NOTIFICATIONS
// ==========================================
router.post("/device-token", saveDeviceToken);
router.post("/fcm-token", registerFcmToken);

// ==========================================
// ADVANCED SETTINGS (Backup & Deletion)
// ==========================================
router.get("/export-data", exportUserData);
router.post("/delete-account/otp", requestDeleteOtp);
router.delete("/delete-account", deleteAccount);

export default router;