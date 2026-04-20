import express from "express";
import {
  sendMessage,
  markMessagesAsRead,
  deleteMessage,
  getMessages,
  reactToMessage
} from "../controllers/message.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { sendMediaMessage } from "../controllers/message.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { sendMessageSchema } from "../validators/message.validator.js";


const router = express.Router();

// POST /api/message
router.post("/", protect, validate(sendMessageSchema), sendMessage);

// PUT /api/message/read
router.put("/read", protect, markMessagesAsRead);

// DELETE /api/message
router.delete("/", protect, deleteMessage);

// GET /api/message/:chatId
router.get("/:chatId", protect, getMessages);

// POST /api/message/media
router.post("/media", protect, upload.single("file"), sendMediaMessage);

// POST /api/message/react
router.post("/react", protect, reactToMessage);

export default router;