import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";

import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { io } from "../server.js";
import admin from "../config/firebase.js";
import { sendMessageSchema } from "../validators/message.validator.js";

// =====================================
// CREATE OR ACCESS 1-to-1 CHAT
// =====================================
export const accessChat = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "UserId is required" });
    }

    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: "Cannot chat with yourself" });
    }

    // Check if chat already exists
    let chat = await Chat.findOne({
      isGroup: false,
      users: { $all: [req.user._id, userId] }
    })
      .populate("users", "-password")
      .populate("lastMessage");

    if (chat) {
      return res.status(200).json(chat);
    }

    // Create new chat
    const newChat = await Chat.create({
      isGroup: false,
      users: [req.user._id, userId]
    });

    const fullChat = await Chat.findById(newChat._id)
      .populate("users", "-password");

    res.status(201).json(fullChat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// GET ALL USER CHATS (WITH UNREAD COUNT)
// =====================================
export const fetchChats = async (req, res) => {
  try {
    const chats = await Chat.find({
      users: { $elemMatch: { $eq: req.user._id } }
    })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("lastMessage", "content sender createdAt")
      .sort({ updatedAt: -1 });

    // Add unread count to each chat
    const formattedChats = chats.map(chat => ({
      ...chat.toObject(),
      unreadCount: chat.unreadCount?.get(req.user._id.toString()) || 0
    }));

    res.status(200).json(formattedChats);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// SEND MESSAGE
// =====================================
export const sendMessage = async (req, res) => {
  try {
    const validation = sendMessageSchema.safeParse(req.body);

    if (!validation.success) {
      // 🔥 FIX: Use .issues[0].message for Zod to prevent 500 crashes
      return res.status(400).json({
        message: validation.error.issues[0].message
      });
    }

    const { content, chatId, replyTo } = validation.data;

    // 🔥 FIX: Safely verify the ObjectId to prevent Mongoose CastErrors
    let safeReplyTo = null;
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      safeReplyTo = replyTo;
    }

    // 1️⃣ Create message
    const newMessage = await Message.create({
      sender: req.user._id,
      content,
      chat: chatId,
      replyTo: safeReplyTo
    });

    // 2️⃣ Populate message
    const populatedMessage = await Message.findById(newMessage._id)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false, // Prevents strict schema errors
        select: "content messageType fileUrl fileName sender",
        populate: {
          path: "sender",
          select: "name username"
        }
      })
      .populate({
        path: "chat",
        populate: {
          path: "users",
          select: "_id name username email"
        }
      });

    // 3️⃣ Update last message
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: populatedMessage._id
    });

    // 4️⃣ Update unread count
    const chat = await Chat.findById(chatId);

    chat.users.forEach(user => {
      const userId = user.toString();

      if (userId !== req.user._id.toString()) {
        const current = chat.unreadCount.get(userId) || 0;
        chat.unreadCount.set(userId, current + 1);
      }
    });

    await chat.save();

    // 5️⃣ Emit real-time message (ONLY message_received)
    io.to(chatId).emit("message_received", populatedMessage);

    // 6️⃣ 🔥 PUSH NOTIFICATION (SAFE BLOCK)
    try {
      const recipients = populatedMessage.chat.users.filter(
        user => user._id.toString() !== req.user._id.toString()
      );

      for (const user of recipients) {
        const targetUser = await User.findById(user._id);

        if (targetUser?.deviceToken) {
          await admin.messaging().send({
            token: targetUser.deviceToken,
            notification: {
              title: req.user.name,
              body: populatedMessage.content || "New message"
            }
          });
        }
      }
    } catch (pushError) {
      console.log("Push notification error:", pushError.message);
    }

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: populatedMessage
    });

  } catch (error) {
    console.error("SendMessage Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// MARK MESSAGES AS READ
// =====================================
export const markMessagesAsRead = async (req, res) => {
  try {
    const { chatId } = req.body;

    if (!chatId) {
      return res.status(400).json({ message: "ChatId required" });
    }

    await Message.updateMany(
      {
        chat: chatId,
        readBy: { $ne: req.user._id }
      },
      {
        $push: { readBy: req.user._id }
      }
    );

    // Reset unread count for current user
    const chat = await Chat.findById(chatId);

    if (chat && chat.unreadCount) {
      chat.unreadCount.set(req.user._id.toString(), 0);
      await chat.save();
    }

    io.to(chatId).emit("messages_read", {
      chatId,
      userId: req.user._id
    });

    res.status(200).json({ message: "Messages marked as read" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// PERMANENT DELETE MESSAGE -> NOW SOFT DELETE
// =====================================
export const deleteMessage = async (req, res) => {
  try {
    // Note: Ensure your Zod validator is checking for messageId
    const { messageId } = req.body;

    if (!messageId) return res.status(400).json({ message: "MessageId required" });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    // ✅ Architecture Rule: Only sender can delete
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const chatId = message.chat.toString();

    // 🔥 THE SOFT DELETE MUTATION
    message.isDeleted = true;
    message.content = ""; // Wipe content for privacy
    message.fileUrl = null; // Unlink media
    message.fileName = null;
    message.reactions = []; // Clear reactions
    
    await message.save();

    // Realtime emit
    io.to(chatId).emit("message_deleted", { 
      messageId: message._id, 
      chatId 
    });

    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// =====================================
// GET MESSAGES WITH PAGINATION
// =====================================
export const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor; // last message createdAt

    let query = { chat: chatId };

    // If cursor exists → fetch older messages
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 }) // newest first
      .limit(limit)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender",
        populate: {
          path: "sender",
          select: "name username"
        }
      });

    // Reverse for frontend (old → new)
    const orderedMessages = messages.reverse();

    // Next cursor = oldest message in this batch
    const nextCursor =
      messages.length > 0
        ? messages[messages.length - 1].createdAt
        : null;

    res.status(200).json({
      messages: orderedMessages,
      nextCursor
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// SEND MEDIA MESSAGE
// =====================================
export const sendMediaMessage = async (req, res) => {
  try {
    const { chatId, replyTo } = req.body;

    if (!req.file || !chatId) {
      return res.status(400).json({
        message: "File and chatId are required"
      });
    }

    // 🔍 Detect message type
    let messageType = "file";

    if (req.file.mimetype.startsWith("image")) {
      messageType = "image";
    } else if (req.file.mimetype.startsWith("video")) {
      messageType = "video";
    }

    // 📤 Upload to Cloudinary
    const uploadFromBuffer = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "auto",
            folder: "chat-app"
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });

    const result = await uploadFromBuffer();

    // 🔥 FIX: Safely verify the ObjectId to prevent Mongoose CastErrors
    let safeReplyTo = null;
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      safeReplyTo = replyTo;
    }

    // 💾 Save message
    const newMessage = await Message.create({
      sender: req.user._id,
      chat: chatId,
      messageType,
      fileUrl: result.secure_url,
      fileName: req.file.originalname,
      replyTo: safeReplyTo
    });

    // 🔄 Populate
    const populatedMessage = await Message.findById(newMessage._id)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender",
        populate: {
          path: "sender",
          select: "name username"
        }
      })
      .populate({
        path: "chat",
        populate: {
          path: "users",
          select: "_id name username email"
        }
      });

    // 📌 Update last message
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: populatedMessage._id
    });

    // 🔔 Update unread
    const chat = await Chat.findById(chatId);

    chat.users.forEach(user => {
      const userId = user.toString();

      if (userId !== req.user._id.toString()) {
        const current = chat.unreadCount.get(userId) || 0;
        chat.unreadCount.set(userId, current + 1);
      }
    });

    await chat.save();

    // ⚡ Real-time emit
    io.to(chatId).emit("message_received", populatedMessage);

    res.status(201).json(populatedMessage);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// REACT TO MESSAGE
// ===================================== 
export const reactToMessage = async (req, res) => {
  try {
    const { messageId, emoji } = req.body;

    if (!messageId || !emoji) {
      return res.status(400).json({
        message: "messageId and emoji required"
      });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        message: "Message not found"
      });
    }

    const userId = req.user._id.toString();

    // Find if emoji already exists
    const existingReaction = message.reactions.find(
      r => r.emoji === emoji
    );

    if (existingReaction) {
      // Toggle user in this emoji
      const alreadyReacted = existingReaction.users.find(
        u => u.toString() === userId
      );

      if (alreadyReacted) {
        // REMOVE reaction
        existingReaction.users = existingReaction.users.filter(
          u => u.toString() !== userId
        );

        // If no users left → remove emoji entry
        if (existingReaction.users.length === 0) {
          message.reactions = message.reactions.filter(
            r => r.emoji !== emoji
          );
        }

      } else {
        // ADD user to existing emoji
        existingReaction.users.push(userId);
      }

    } else {
      // Create new emoji reaction
      message.reactions.push({
        emoji,
        users: [userId]
      });
    }

    await message.save();

    // 🔥 Emit realtime update
    io.to(message.chat.toString()).emit("message_reacted", {
      messageId,
      reactions: message.reactions
    });

    res.status(200).json({
      message: "Reaction updated",
      reactions: message.reactions
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};