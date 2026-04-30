import mongoose from "mongoose"; // 🔥 Required for safely verifying ObjectIds
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

    if (!userId) return res.status(400).json({ message: "UserId is required" });
    if (userId === req.user._id.toString()) return res.status(400).json({ message: "Cannot chat with yourself" });

    let chat = await Chat.findOne({
      isGroup: false,
      users: { $all: [req.user._id, userId] }
    })
      .populate("users", "-password")
      .populate("lastMessage");

    if (chat) return res.status(200).json(chat);

    const newChat = await Chat.create({
      isGroup: false,
      users: [req.user._id, userId]
    });

    const fullChat = await Chat.findById(newChat._id).populate("users", "-password");
    res.status(201).json(fullChat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// GET ALL USER CHATS
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
      return res.status(400).json({ message: validation.error.errors[0].message });
    }
    const { content, chatId, replyTo } = validation.data;

    // 🔥 Safely verify the ObjectId to prevent Mongoose CastErrors
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
        strictPopulate: false, // 🔥 Prevents 500 crash if old schema is cached
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
    await Chat.findByIdAndUpdate(chatId, { lastMessage: populatedMessage._id });

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

    // 5️⃣ Emit real-time message
    io.to(chatId).emit("message_received", populatedMessage);

    // 6️⃣ Push Notification
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
// GET MESSAGES WITH PAGINATION
// =====================================
export const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor;

    let query = { chat: chatId };
    if (cursor) query.createdAt = { $lt: new Date(cursor) };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
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

    const orderedMessages = messages.reverse();
    const nextCursor = messages.length > 0 ? messages[messages.length - 1].createdAt : null;

    res.status(200).json({ messages: orderedMessages, nextCursor });
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

    if (!req.file || !chatId) return res.status(400).json({ message: "File and chatId are required" });

    let messageType = "file";
    if (req.file.mimetype.startsWith("image")) messageType = "image";
    else if (req.file.mimetype.startsWith("video")) messageType = "video";

    const uploadFromBuffer = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "auto", folder: "chat-app" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });

    const result = await uploadFromBuffer();

    let safeReplyTo = null;
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      safeReplyTo = replyTo;
    }

    const newMessage = await Message.create({
      sender: req.user._id,
      chat: chatId,
      messageType,
      fileUrl: result.secure_url,
      fileName: req.file.originalname,
      replyTo: safeReplyTo
    });

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
        populate: { path: "users", select: "_id name username email" }
      });

    await Chat.findByIdAndUpdate(chatId, { lastMessage: populatedMessage._id });

    const chat = await Chat.findById(chatId);
    chat.users.forEach(user => {
      const userId = user.toString();
      if (userId !== req.user._id.toString()) {
        const current = chat.unreadCount.get(userId) || 0;
        chat.unreadCount.set(userId, current + 1);
      }
    });
    await chat.save();

    io.to(chatId).emit("message_received", populatedMessage);
    res.status(201).json(populatedMessage);

  } catch (error) {
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
// PERMANENT DELETE MESSAGE
// =====================================
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ message: "MessageId required" });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (message.readBy && message.readBy.length > 0) {
      return res.status(400).json({
        message: "Cannot delete message after it has been read"
      });
    }

    const chatId = message.chat.toString();

    await Message.findByIdAndDelete(messageId);

    const lastMessage = await Message.findOne({ chat: chatId })
      .sort({ createdAt: -1 });

    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: lastMessage ? lastMessage._id : null
    });

    io.to(chatId).emit("message_deleted", {
      messageId
    });

    res.status(200).json({
      message: "Message deleted successfully"
    });

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

    const existingReaction = message.reactions.find(
      r => r.emoji === emoji
    );

    if (existingReaction) {
      const alreadyReacted = existingReaction.users.find(
        u => u.toString() === userId
      );

      if (alreadyReacted) {
        existingReaction.users = existingReaction.users.filter(
          u => u.toString() !== userId
        );

        if (existingReaction.users.length === 0) {
          message.reactions = message.reactions.filter(
            r => r.emoji !== emoji
          );
        }

      } else {
        existingReaction.users.push(userId);
      }

    } else {
      message.reactions.push({
        emoji,
        users: [userId]
      });
    }

    await message.save();

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