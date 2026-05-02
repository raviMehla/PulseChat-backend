import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
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
router.post("/", protect, sendMessage);
router.post("/media", protect, upload.single("file"), sendMediaMessage);

// =====================================
// MUTATIONS & UPDATES (PUT / DELETE)
// =====================================
router.put("/read", protect, markMessagesAsRead);
router.put("/react", protect, reactToMessage); // Changed to PUT: Updating an existing entity

// 🔥 CRITICAL: Since you are using a URL param, your controller MUST read req.params.messageId
router.delete("/:messageId", protect, deleteMessage);

// =====================================
// FETCHING & QUERIES (GET)
// 🚨 CRITICAL ORDERING: Specific paths before generic parameters
// =====================================

// 1. Specific Search Route (Standardized to RESTful nested formatting)
router.get("/:chatId/search", protect, searchMessages);

// 2. Specific Deep History / Context Route
router.get("/:chatId/context/:messageId", protect, getMessageContext);

// 3. Generic Fetch Route (Must remain at the very bottom)
router.get("/:chatId", protect, getMessages);

export default router;