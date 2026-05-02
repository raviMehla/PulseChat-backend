import { searchMessageSchema, sendMessageSchema } from "../validators/message.validator.js";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import { getIO } from "../socket.js";
import { sendPushNotification } from "../services/notification.service.js"; // 🔥 Import the new service

// =====================================
// SEND TEXT MESSAGE
// =====================================
export const sendMessage = async (req, res) => {
  try {
    const validation = sendMessageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { content, chatId, replyTo } = validation.data;
    let safeReplyTo = (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) ? replyTo : null;

    const newMessage = await Message.create({
      sender: req.user._id,
      content,
      chat: chatId,
      replyTo: safeReplyTo
    });

    const populatedMessage = await Message.findById(newMessage._id)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender",
        populate: { path: "sender", select: "name username" }
      })
      .populate({
        path: "chat",
        populate: { path: "users", select: "_id name username email fcmTokens" } 
      });

    await Chat.findByIdAndUpdate(chatId, { lastMessage: populatedMessage._id });

    // Update unread counts
    const chat = await Chat.findById(chatId);
    chat.users.forEach(user => {
      const userId = user.toString();
      if (userId !== req.user._id.toString()) {
        chat.unreadCount.set(userId, (chat.unreadCount.get(userId) || 0) + 1);
      }
    });
    await chat.save();

    // 🔥 Real-time emit
    const io = getIO();
    io.to(chatId).emit("message_received", populatedMessage);

    // 🔥 Abstracted Service Call
    sendPushNotification(populatedMessage.chat, req.user, content, "text");

    res.status(201).json({ success: true, data: populatedMessage });
  } catch (error) {
    console.error("SendMessage Error:", error);
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
    let safeReplyTo = (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) ? replyTo : null;

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
        populate: { path: "sender", select: "name username" }
      })
      .populate({
        path: "chat",
        populate: { path: "users", select: "_id name username email fcmTokens" }
      });

    await Chat.findByIdAndUpdate(chatId, { lastMessage: populatedMessage._id });

    const chat = await Chat.findById(chatId);
    chat.users.forEach(user => {
      const userId = user.toString();
      if (userId !== req.user._id.toString()) {
        chat.unreadCount.set(userId, (chat.unreadCount.get(userId) || 0) + 1);
      }
    });
    await chat.save();

    const io = getIO();
    io.to(chatId).emit("message_received", populatedMessage);

    // 🔥 Abstracted Service Call
    sendPushNotification(populatedMessage.chat, req.user, null, messageType);

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
    if (!chatId) return res.status(400).json({ message: "ChatId required" });

    await Message.updateMany(
      { chat: chatId, readBy: { $ne: req.user._id } },
      { $push: { readBy: req.user._id } }
    );

    const chat = await Chat.findById(chatId);
    if (chat && chat.unreadCount) {
      chat.unreadCount.set(req.user._id.toString(), 0);
      await chat.save();
    }

    const io = getIO();
    io.to(chatId).emit("messages_read", { chatId, userId: req.user._id });
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
    // 🔥 ARCHITECTURAL FIX: Extract from req.params to match the router (/:messageId)
    const { messageId } = req.params;
    
    if (!messageId) return res.status(400).json({ message: "MessageId required in URL parameters" });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const chatId = message.chat.toString();

    message.isDeleted = true;
    message.content = ""; 
    message.fileUrl = null; 
    message.fileName = null;
    message.reactions = []; 
    
    await message.save();

    const io = getIO();
    io.to(chatId).emit("message_deleted", { messageId: message._id, chatId });
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
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username" }
      });

    const orderedMessages = messages.reverse();
    const nextCursor = messages.length > 0 ? messages[messages.length - 1].createdAt : null;

    res.status(200).json({ messages: orderedMessages, nextCursor });
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
    if (!messageId || !emoji) return res.status(400).json({ message: "messageId and emoji required" });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    const userId = req.user._id.toString();
    const existingReaction = message.reactions.find(r => r.emoji === emoji);

    if (existingReaction) {
      const alreadyReacted = existingReaction.users.find(u => u.toString() === userId);
      if (alreadyReacted) {
        existingReaction.users = existingReaction.users.filter(u => u.toString() !== userId);
        if (existingReaction.users.length === 0) {
          message.reactions = message.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        existingReaction.users.push(userId);
      }
    } else {
      message.reactions.push({ emoji, users: [userId] });
    }

    await message.save();
    const io = getIO();
    io.to(message.chat.toString()).emit("message_reacted", {
      messageId,
      reactions: message.reactions
    });

    res.status(200).json({ message: "Reaction updated", reactions: message.reactions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// SEARCH MESSAGES (CHAT-LEVEL)
// =====================================
export const searchMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query } = req.query;

    const validation = searchMessageSchema.safeParse({ chatId, query });
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const messages = await Message.find({
      chat: chatId,
      isDeleted: { $ne: true },
      $or: [
        { messageType: "text" },
        { messageType: { $exists: false } },
        { messageType: null }
      ],
      content: { $regex: validation.data.query, $options: "i" }
    })
      .select("_id content createdAt sender") 
      .populate("sender", "name username")
      .sort({ createdAt: -1 }) 
      .limit(50); 

    res.status(200).json(messages);
  } catch (error) {
    console.error("Search Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// GET MESSAGE CONTEXT (DEEP HISTORY JUMP)
// =====================================
export const getMessageContext = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const targetMessage = await Message.findById(messageId)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username" }
      });

    if (!targetMessage) return res.status(404).json({ message: "Target message not found" });

    const olderMessages = await Message.find({
      chat: chatId,
      createdAt: { $lt: targetMessage.createdAt }
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username" }
      });

    const newerMessages = await Message.find({
      chat: chatId,
      createdAt: { $gt: targetMessage.createdAt }
    })
      .sort({ createdAt: 1 })
      .limit(15)
      .populate("sender", "name username email")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username" }
      });

    const contextSlice = [
      ...olderMessages.reverse(),
      targetMessage,
      ...newerMessages
    ];

    res.status(200).json(contextSlice);
  } catch (error) {
    console.error("Context Fetch Error:", error);
    res.status(500).json({ message: error.message });
  }
};