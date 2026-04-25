import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  updateProfile,
  updateProfilePic,
  updatePrivacy,
  getProfile,
  saveDeviceToken,
  getUserStatus
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


export default router;
