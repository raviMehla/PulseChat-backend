import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  updateProfile,
  updateProfilePic,
  updatePrivacy,
  getProfile,
  saveDeviceToken,
  getUserStatus,
  searchUsers
} from "../controllers/user.controller.js";

import {upload} from "../middleware/upload.middleware.js";


const router = express.Router();

router.get("/profile", protect, getProfile);

router.post("/device-token", protect, saveDeviceToken);

router.get("/profile", protect, getProfile);

router.put("/profile", protect, updateProfile);

router.get("/status/:id", protect, getUserStatus);

router.put(
  "/profile-pic",
  protect,
  upload.single("profilePic"),
  updateProfilePic
);

router.put("/privacy", protect, updatePrivacy);

// Route to search for users (e.g., /api/users/search?search=john)
router.get("/search", protect, searchUsers);

// Route to get a specific user's status
router.get("/status/:userId", protect, getUserStatus);


export default router;
