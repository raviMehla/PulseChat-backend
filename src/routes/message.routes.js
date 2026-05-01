

import express from "express";
import {
  sendMessage,
  markMessagesAsRead,
  deleteMessage,
  getMessages,
  reactToMessage,
  sendMediaMessage,
  searchMessages,      // 🔥 NEW: Imported Search Controller
  getMessageContext    // 🔥 NEW: Imported Context Controller
} from "../controllers/message.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
// Note: validate and sendMessageSchema can be used here if you attach them as middleware, 
// but currently you are doing safeParse inside the controller, which is perfectly fine.

const router = express.Router();

// =====================================
// POST, PUT, DELETE ROUTES
// =====================================

router.post("/", protect, sendMessage);
router.put("/read", protect, markMessagesAsRead);
router.post("/media", protect, upload.single("file"), sendMediaMessage);
router.post("/react", protect, reactToMessage);

// 🔥 RESTORED FIX: Delete requires the ID in the URL params
router.delete("/:messageId", protect, deleteMessage);


// =====================================
// GET ROUTES (CRITICAL ORDERING)
// =====================================

// 1. MOST SPECIFIC routes must come first
router.get("/search/:chatId", protect, searchMessages);

// 2. MULTI-PARAM routes come second
router.get("/:chatId/context/:messageId", protect, getMessageContext);

// 3. GENERIC catch-all parameter comes LAST
router.get("/:chatId", protect, getMessages);


export default router;