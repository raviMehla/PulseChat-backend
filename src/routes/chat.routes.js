import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import {
  accessChat,
  fetchChats,
  createGroupChat,
  //renameGroup,
  updateGroupDetails, // 🛡️ Import the new controller
  addToGroup,
  removeFromGroup,
  leaveGroup,
  deleteChat,
  promoteToAdmin
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
router.post("/group", protect, upload.single("groupAvatar"), createGroupChat);
//router.put("/group/rename", protect, renameGroup); // Kept for backward compatibility

// 🛡️ ARCHITECTURAL UPGRADE: The missing endpoint
router.put("/group/:chatId/details", protect, upload.single("groupAvatar"), updateGroupDetails);

router.put("/group/add", protect, addToGroup);
router.put("/group/remove", protect, removeFromGroup);
router.put("/group/leave", protect, leaveGroup);
router.put("/group/promote", protect, promoteToAdmin);
router.delete("/:chatId", protect, deleteChat);

export default router;