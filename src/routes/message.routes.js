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

// 🔥 CRITICAL: Deletion Route
router.delete("/:messageId", protect, deleteMessage);

// =====================================
// FETCHING & QUERIES (GET)
// 🚨 CRITICAL ORDERING: Static prefixes must go BEFORE generic /:chatId parameters
// =====================================

// 1. 🛡️ SEARCH FIX: Matches the frontend GET /api/message/search/:chatId
router.get("/search/:chatId", protect, heavyTaskLimiter, searchMessages);

// 2. CONTEXT FIX: Matches frontend context fetch
router.get("/context/:chatId/:messageId", protect, getMessageContext);

// 3. Generic Fetch Route (Must remain at the very bottom so it doesn't hijack /search)
router.get("/:chatId", protect, getMessages);

export default router;