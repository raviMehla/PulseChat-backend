import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { messageLimiter, heavyTaskLimiter } from "../middleware/rateLimit.middleware.js"; // 🔥 NEW: Security Middleware
import {
  sendMessage,
  markMessagesAsRead,
  deleteMessage,
  getMessages,
  reactToMessage,
  sendMediaMessage,
  searchMessages,
  getMessageContext
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

// 🔥 CRITICAL: Since you are using a URL param, your controller MUST read req.params.messageId
router.delete("/:messageId", protect, deleteMessage);

// =====================================
// FETCHING & QUERIES (GET)
// 🚨 CRITICAL ORDERING: Specific paths before generic parameters
// =====================================

// 1. Specific Search Route (Standardized to RESTful nested formatting)
// 🛡️ Protected against database CPU exhaustion via regex spam
router.get("/:chatId/search", protect, heavyTaskLimiter, searchMessages);

// 2. Specific Deep History / Context Route
router.get("/:chatId/context/:messageId", protect, getMessageContext);

// 3. Generic Fetch Route (Must remain at the very bottom)
router.get("/:chatId", protect, getMessages);

export default router;