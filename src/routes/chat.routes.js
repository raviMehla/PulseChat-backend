import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  leaveGroup
} from "../controllers/chat.controller.js";

const router = express.Router();

// ==========================================
// 1-ON-1 CHAT ROUTES
// ==========================================
router.post("/", protect, accessChat);
router.get("/", protect, fetchChats);

// ==========================================
// GROUP CHAT ROUTES
// ==========================================
router.post("/group", protect, createGroupChat);
router.put("/group/rename", protect, renameGroup);
router.put("/group/add", protect, addToGroup);
router.put("/group/remove", protect, removeFromGroup);
router.put("/group/leave", protect, leaveGroup);

export default router;