import express from "express";
import { getProfile } from "../controllers/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { saveDeviceToken } from "../controllers/user.controller.js";

const router = express.Router();

router.get("/profile", protect, getProfile);

router.post("/device-token", protect, saveDeviceToken);

export default router;
