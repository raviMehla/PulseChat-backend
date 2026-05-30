import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { messageLimiter, heavyTaskLimiter } from "../middleware/rateLimit.middleware.js";
import {
  sendMessage,
  markMessagesAsRead,
  deleteMessage,
  getMessages,
  reactToMessage,
  sendMediaMessage,
  searchMessages,
  getMessageContext,
  editMessage,
  pinMessage,
  starMessage,
  getStarredMessages
} from "../controllers/message.controller.js";

const router = express.Router();

// =====================================
// CREATION & MEDIA (POST)
// =====================================
// 🛡️ Protected against message spam bots
router.post("/", protect, messageLimiter, sendMessage);

// 🛡️ Protected against bandwidth/Cloudinary abuse
router.post("/media", protect, heavyTaskLimiter, upload.single("file"), sendMediaMessage);

// =====================================
// MUTATIONS & UPDATES (PUT / DELETE)
// =====================================
router.put("/read", protect, markMessagesAsRead);

// Note: We leave /react without HTTP rate limits here because reaction spam 
// will be handled efficiently via Socket.IO cooldowns in Phase 2.
router.put("/react", protect, reactToMessage); 

// 🔥 CRITICAL: Deletion Route
router.delete("/:messageId", protect, deleteMessage);

router.put("/:messageId/edit", protect, editMessage);
router.put("/:messageId/pin", protect, pinMessage);
router.put("/:messageId/star", protect, starMessage);

// =====================================
// FETCHING & QUERIES (GET)
// 🚨 CRITICAL ORDERING: Specific paths must go BEFORE generic parameters
// =====================================

// 1. Search Route
router.get("/search/:chatId", protect, heavyTaskLimiter, searchMessages);

// 2. Starred Messages Route (must come BEFORE /:chatId to avoid ambiguity)
router.get("/starred", protect, getStarredMessages);

// 3. 🛡️ CONTEXT FIX: Realigned to match frontend /:chatId/context/:messageId
router.get("/:chatId/context/:messageId", protect, getMessageContext);

// 4. Generic Fetch Route (Must remain at the very bottom)
router.get("/:chatId", protect, getMessages);

export default router;