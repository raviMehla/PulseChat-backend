import { searchMessageSchema, sendMessageSchema, getMessageHistorySchema   } from "../validators/message.validator.js";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js"; // 🔥 Imported User for privacy checks
import { getIO } from "../socket.js";
import { sendPushNotification } from "../services/notification.service.js";
import { verifyFileMimeType } from "../utils/fileVerifier.js";

// 🛡️ AUTHORIZATION HELPER
// Verifies the requesting user is a member of the chat.
// Returns the chat document so callers can reuse it; throws 403 if unauthorized.
const verifyChatMembership = async (chatId, userId, res) => {
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    res.status(400).json({ message: "Invalid chat ID format" });
    return null;
  }
  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404).json({ message: "Chat not found" });
    return null;
  }
  const isMember = chat.users.some(u => String(u) === String(userId));
  if (!isMember) {
    res.status(403).json({ message: "You are not a member of this chat." });
    return null;
  }
  return chat;
};

export const sendMessage = async (req, res) => {
  try {
    const validation = sendMessageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { content, chatId, replyTo, messageType, fileUrl, fileName, duration, isForwarded, iv, isEncrypted } = validation.data;
    const senderId = req.user._id;

    // 1️⃣ Verify membership (replaces manual Chat.findById + not-found check)
    const chatContext = await verifyChatMembership(chatId, senderId, res);
    if (!chatContext) return;

    // 2️⃣ 🛡️ PRIVACY ENFORCEMENT: Check Block Status (1-on-1 Chats Only)
    if (!chatContext.isGroup) {
      const receiverId = chatContext.users.find(u => String(u) !== String(senderId));
      
      if (receiverId) {
        // Fetch both users concurrently for performance
        const [sender, receiver] = await Promise.all([
          User.findById(senderId).select("blockedUsers"),
          User.findById(receiverId).select("blockedUsers")
        ]);

        if (sender.blockedUsers.includes(receiverId)) {
          return res.status(403).json({ message: "You have blocked this user. Unblock them to send a message." });
        }
        if (receiver.blockedUsers.includes(senderId)) {
          return res.status(403).json({ message: "Cannot send messages to this user at this time." });
        }
      }
    }

    // 3️⃣ Auto-unhide chat for receivers who had soft-deleted it (hiddenFor)
    const receiverIds = chatContext.users
      .map(u => String(u))
      .filter(id => id !== String(senderId));

    if (receiverIds.length > 0) {
      await Chat.findByIdAndUpdate(chatId, {
        $pull: { hiddenFor: { $in: receiverIds } }
      });
      const io = getIO();
      io.to(receiverIds).emit("chat_unhidden", { chatId });
    }

    let safeReplyTo = (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) ? replyTo : null;

    const newMessage = await Message.create({
      sender: senderId,
      content,
      chat: chatId,
      replyTo: safeReplyTo,
      messageType: messageType || "text",
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      duration: duration || null,
      isForwarded: isForwarded === true,
      iv: iv || null,
      isEncrypted: isEncrypted === true
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

    // 🛡️ LEVEL 10 FIX: Prevent same-millisecond race conditions using ObjectId chronology check
    await Chat.findOneAndUpdate(
      { 
        _id: chatId, 
        $or: [
          { lastMessage: { $exists: false } }, 
          { lastMessage: null }, 
          { lastMessage: { $lte: newMessage._id } }
        ] 
      },
      { $set: { lastMessage: newMessage._id, lastMessageAt: newMessage.createdAt } }
    );

    // Update unread counts atomically and fetch point-in-time POJO snap to avoid race conditions
    const incUpdate = {};
    chatContext.users.forEach(user => {
      const userIdStr = user.toString();
      if (userIdStr !== senderId.toString()) {
        incUpdate[`unreadCount.${userIdStr}`] = 1;
      }
    });

    let unreadQuery = null;
    if (Object.keys(incUpdate).length > 0) {
      unreadQuery = await Chat.findOneAndUpdate(
        { _id: chatId },
        { $inc: incUpdate },
        { returnDocument: "after", projection: { unreadCount: 1 }, lean: true }
      );
    } else {
      unreadQuery = await Chat.findById(chatId).select("unreadCount").lean();
    }
    
    // 🔥 Abstracted Service Call - executed before stripping fcmTokens/emails
    const notificationContent = isEncrypted ? "🔒 Encrypted Message" : content;
    sendPushNotification(populatedMessage.chat, req.user, notificationContent, messageType || "text");

    // 🛡️ LEVEL 11 FIX: Sanitize message payload to prevent sensitive data leaks (emails, fcmTokens)
    const sanitizedMessage = populatedMessage.toObject();
    if (sanitizedMessage.chat && Array.isArray(sanitizedMessage.chat.users)) {
      sanitizedMessage.chat.users = sanitizedMessage.chat.users.map(u => ({
        _id: u._id,
        name: u.name,
        username: u.username
      }));
    }

    // 🔥 Real-time emit using sanitized payload
    const io = getIO();
    io.to(chatId).emit("message_received", sanitizedMessage);

    // 🛡️ LEVEL 7 FIX: Broadcast updated unread counts Map converted to standard JS object
    const unreadCountsObj = {};
    if (unreadQuery && unreadQuery.unreadCount) {
      if (unreadQuery.unreadCount instanceof Map) {
        unreadQuery.unreadCount.forEach((val, key) => {
          unreadCountsObj[key] = val;
        });
      } else if (typeof unreadQuery.unreadCount.forEach === "function") {
        unreadQuery.unreadCount.forEach((val, key) => {
          unreadCountsObj[key] = val;
        });
      } else {
        Object.assign(unreadCountsObj, unreadQuery.unreadCount);
      }
    }
    io.to(chatId).emit("unread_update", { chatId, unreadCounts: unreadCountsObj });
    chatContext.users.forEach(user => {
      io.to(String(user._id || user)).emit("unread_update", { chatId, unreadCounts: unreadCountsObj });
    });

    res.status(201).json({ success: true, data: sanitizedMessage });
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
    const { chatId, replyTo, content, messageType: bodyMessageType, duration } = req.body;
    const senderId = req.user._id;

    if (!req.file || !chatId) return res.status(400).json({ message: "File and chatId are required" });

    // Server-side binary signature content verification to prevent MIME spoofing
    if (!verifyFileMimeType(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ message: "File content does not match the declared MIME type. Upload blocked." });
    }

    // 1️⃣ Verify membership
    const chatContext = await verifyChatMembership(chatId, senderId, res);
    if (!chatContext) return;

    // 2️⃣ 🛡️ PRIVACY ENFORCEMENT: Block check BEFORE any DB updates or Cloudinary uploads
    if (!chatContext.isGroup) {
      const receiverId = chatContext.users.find(u => String(u) !== String(senderId));
      
      if (receiverId) {
        const [sender, receiver] = await Promise.all([
          User.findById(senderId).select("blockedUsers"),
          User.findById(receiverId).select("blockedUsers")
        ]);

        if (sender.blockedUsers.includes(receiverId)) {
          return res.status(403).json({ message: "You have blocked this user. Unblock them to send a message." });
        }
        if (receiver.blockedUsers.includes(senderId)) {
          return res.status(403).json({ message: "Cannot send messages to this user at this time." });
        }
      }
    }

    // 3️⃣ Auto-unhide chat for receivers who had soft-deleted it (hiddenFor)
    const receiverIds = chatContext.users
      .map(u => String(u))
      .filter(id => id !== String(senderId));

    if (receiverIds.length > 0) {
      await Chat.findByIdAndUpdate(chatId, {
        $pull: { hiddenFor: { $in: receiverIds } }
      });
      const io = getIO();
      io.to(receiverIds).emit("chat_unhidden", { chatId });
    }

    let messageType = bodyMessageType || "file";
    if (!bodyMessageType) {
      if (req.file.mimetype.startsWith("image")) messageType = "image";
      else if (req.file.mimetype.startsWith("video")) messageType = "video";
      else if (req.file.mimetype.startsWith("audio")) messageType = "audio";
    }

    const uploadFromBuffer = () =>
      new Promise((resolve, reject) => {
        // 🛡️ ARCHITECTURAL FIX: Strict 45-second timeout to prevent infinite hangs
        const timer = setTimeout(() => {
          reject(new Error("Cloudinary upload timed out after 45 seconds."));
        }, 45000);

        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "auto", folder: "chat-app" },
          (error, result) => {
            clearTimeout(timer); // Clear the timeout if it succeeds
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });

    const result = await uploadFromBuffer();
    let safeReplyTo = (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) ? replyTo : null;

    const newMessage = await Message.create({
      sender: senderId,
      chat: chatId,
      content: content || null,
      messageType,
      fileUrl: result.secure_url,
      fileName: req.file.originalname,
      duration: duration || null,
      replyTo: safeReplyTo,
      isForwarded: req.body.isForwarded === true
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

    // 🛡️ LEVEL 10 FIX: Prevent same-millisecond race conditions using ObjectId chronology check
    await Chat.findOneAndUpdate(
      { 
        _id: chatId, 
        $or: [
          { lastMessage: { $exists: false } }, 
          { lastMessage: null }, 
          { lastMessage: { $lte: newMessage._id } }
        ] 
      },
      { $set: { lastMessage: newMessage._id, lastMessageAt: newMessage.createdAt } }
    );

    // Update unread counts atomically and fetch point-in-time POJO snap to avoid race conditions
    const incUpdate = {};
    chatContext.users.forEach(user => {
      const userIdStr = user.toString();
      if (userIdStr !== senderId.toString()) {
        incUpdate[`unreadCount.${userIdStr}`] = 1;
      }
    });

    let unreadQuery = null;
    if (Object.keys(incUpdate).length > 0) {
      unreadQuery = await Chat.findOneAndUpdate(
        { _id: chatId },
        { $inc: incUpdate },
        { returnDocument: "after", projection: { unreadCount: 1 }, lean: true }
      );
    } else {
      unreadQuery = await Chat.findById(chatId).select("unreadCount").lean();
    }

    // 🔥 Abstracted Service Call - executed before stripping fcmTokens/emails
    sendPushNotification(populatedMessage.chat, req.user, null, messageType);

    // 🛡️ LEVEL 11 FIX: Sanitize message payload to prevent sensitive data leaks (emails, fcmTokens)
    const sanitizedMessage = populatedMessage.toObject();
    if (sanitizedMessage.chat && Array.isArray(sanitizedMessage.chat.users)) {
      sanitizedMessage.chat.users = sanitizedMessage.chat.users.map(u => ({
        _id: u._id,
        name: u.name,
        username: u.username
      }));
    }

    // 🔥 Real-time emit using sanitized payload
    const io = getIO();
    io.to(chatId).emit("message_received", sanitizedMessage);

    // 🛡️ LEVEL 7 FIX: Broadcast updated unread counts Map converted to standard JS object
    const unreadCountsObj = {};
    if (unreadQuery && unreadQuery.unreadCount) {
      if (unreadQuery.unreadCount instanceof Map) {
        unreadQuery.unreadCount.forEach((val, key) => {
          unreadCountsObj[key] = val;
        });
      } else if (typeof unreadQuery.unreadCount.forEach === "function") {
        unreadQuery.unreadCount.forEach((val, key) => {
          unreadCountsObj[key] = val;
        });
      } else {
        Object.assign(unreadCountsObj, unreadQuery.unreadCount);
      }
    }
    io.to(chatId).emit("unread_update", { chatId, unreadCounts: unreadCountsObj });
    chatContext.users.forEach(user => {
      io.to(String(user._id || user)).emit("unread_update", { chatId, unreadCounts: unreadCountsObj });
    });

    res.status(201).json({ success: true, data: sanitizedMessage });
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
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: "Invalid chat ID format" });
    }

    await Message.updateMany(
      { chat: chatId, readBy: { $ne: req.user._id } },
      { $push: { readBy: req.user._id } }
    );

    await Chat.findByIdAndUpdate(chatId, {
      $set: { [`unreadCount.${String(req.user._id)}`]: 0 }
    });

    const io = getIO();
    io.to(chatId).emit("messages_read", { chatId, userId: req.user._id });
    io.to(String(req.user._id)).emit("self_messages_read", { chatId });
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
    const { messageId } = req.params;
    
    if (!messageId) return res.status(400).json({ message: "MessageId required in URL parameters" });
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const chatId = message.chat.toString();

    // 🛡️ ARCHITECTURAL FIX: Destroy the orphaned file from Cloudinary
    if (message.fileUrl) {
      try {
        const urlParts = message.fileUrl.split("/");
        const folderAndFile = urlParts.slice(-2).join("/"); // gets "chat-app/filename.jpg"
        const publicId = folderAndFile.split(".")[0]; // removes extension
        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryErr) {
        console.error("Failed to delete file from Cloudinary:", cloudinaryErr);
      }
    }

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

    // 🛡️ Verify membership before allowing message history access
    const chatDoc = await verifyChatMembership(chatId, req.user._id, res);
    if (!chatDoc) return;

    // 🛡️ Zod Validation for Query Params
    const validation = getMessageHistorySchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({ message: "Invalid pagination parameters" });
    }

    const limit = validation.data.limit || 20;
    const cursor = validation.data.cursor; 

    let query = { chat: chatId };
    
    // Apply Cursor-based $lt filter
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

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
    // The oldest message in this batch becomes the cursor for the next batch
    const nextCursor = messages.length > 0 ? messages[0].createdAt : null;

    res.status(200).json({ messages: orderedMessages, nextCursor });
  } catch (error) {
    console.error("Get Messages Error:", error);
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
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    // Verify target message exists
    const messageExists = await Message.findById(messageId).select("chat");
    if (!messageExists) return res.status(404).json({ message: "Message not found" });

    const userId = req.user._id.toString();

    // 🛡️ LEVEL 11 FIX: Atomic database toggles for reactions to prevent race conditions
    // 1. Try to remove the user's ID from an existing reaction matching the emoji
    let updatedMessage = await Message.findOneAndUpdate(
      { 
        _id: messageId, 
        reactions: { $elemMatch: { emoji, users: userId } } 
      },
      { 
        $pull: { "reactions.$.users": userId } 
      },
      { returnDocument: "after" }
    );

    let updatedReactions = [];

    if (updatedMessage) {
      // Clean up empty reaction entries where users array became empty
      const cleanedMessage = await Message.findOneAndUpdate(
        { _id: messageId },
        { $pull: { reactions: { users: { $size: 0 } } } },
        { returnDocument: "after" }
      );
      updatedReactions = cleanedMessage ? cleanedMessage.reactions : [];
    } else {
      // 2. Try to add the user to an existing reaction for this emoji
      updatedMessage = await Message.findOneAndUpdate(
        { 
          _id: messageId, 
          "reactions.emoji": emoji 
        },
        { 
          $addToSet: { "reactions.$.users": userId } 
        },
        { returnDocument: "after" }
      );

      if (updatedMessage) {
        updatedReactions = updatedMessage.reactions;
      } else {
        // 3. Create a new reaction object for this emoji
        updatedMessage = await Message.findOneAndUpdate(
          { 
            _id: messageId,
            "reactions.emoji": { $ne: emoji }
          },
          { 
            $push: { reactions: { emoji, users: [userId] } } 
          },
          { returnDocument: "after" }
        );
        updatedReactions = updatedMessage ? updatedMessage.reactions : [];
      }
    }

    const io = getIO();
    io.to(messageExists.chat.toString()).emit("message_reacted", {
      messageId,
      reactions: updatedReactions
    });

    res.status(200).json({ message: "Reaction updated", reactions: updatedReactions });
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

    const chatDoc = await verifyChatMembership(chatId, req.user._id, res);
    if (!chatDoc) return;

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

    const chatDoc = await verifyChatMembership(chatId, req.user._id, res);
    if (!chatDoc) return;

    const targetMessage = await Message.findById(messageId)
      .populate("sender", "name username profilePic")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username profilePic" }
      });

    if (!targetMessage) return res.status(404).json({ message: "Target message not found" });
    if (String(targetMessage.chat) !== String(chatId)) {
      return res.status(404).json({ message: "Target message not found in this chat" });
    }

    const olderMessages = await Message.find({
      chat: chatId,
      _id: { $lt: targetMessage._id }
    })
      .sort({ _id: -1 })
      .limit(15)
      .populate("sender", "name username profilePic")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username profilePic" }
      });

    const newerMessages = await Message.find({
      chat: chatId,
      _id: { $gt: targetMessage._id }
    })
      .sort({ _id: 1 })
      .limit(15)
      .populate("sender", "name username profilePic")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username profilePic" }
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

// =====================================
// EDIT MESSAGE
// =====================================
export const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({ message: "Content is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    if (String(message.sender) !== String(req.user._id)) {
      return res.status(403).json({ message: "Not authorized to edit this message" });
    }

    if (message.isDeleted) {
      return res.status(400).json({ message: "Cannot edit a deleted message" });
    }

    if (message.messageType && message.messageType !== "text") {
      return res.status(400).json({ message: "Only text messages can be edited" });
    }

    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    const populatedMessage = await Message.findById(message._id)
      .populate("sender", "name username profilePic")
      .populate({
        path: "replyTo",
        strictPopulate: false,
        select: "content messageType fileUrl fileName sender isDeleted",
        populate: { path: "sender", select: "name username profilePic" }
      });

    const io = getIO();
    io.to(message.chat.toString()).emit("message_edited", populatedMessage);

    res.status(200).json({ success: true, data: populatedMessage });
  } catch (error) {
    console.error("Edit Message Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// PIN MESSAGE
// =====================================
export const pinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    const chatId = message.chat.toString();
    const chatDoc = await Chat.findById(chatId);
    if (!chatDoc || !chatDoc.users.some(u => String(u) === String(req.user._id))) {
      return res.status(403).json({ message: "Not authorized to pin in this chat" });
    }

    message.isPinned = !message.isPinned;
    await message.save();

    const io = getIO();
    io.to(chatId).emit("message_pinned", { messageId: message._id, isPinned: message.isPinned, chatId });

    res.status(200).json({ success: true, isPinned: message.isPinned });
  } catch (error) {
    console.error("Pin Message Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// STAR MESSAGE
// =====================================
export const starMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: "Message not found" });

    const chatId = message.chat.toString();
    const chatDoc = await Chat.findById(chatId);
    if (!chatDoc || !chatDoc.users.some(u => String(u) === String(userId))) {
      return res.status(403).json({ message: "Not authorized to star in this chat" });
    }

    const isStarred = message.isStarred.some(u => String(u) === String(userId));
    if (isStarred) {
      message.isStarred = message.isStarred.filter(u => String(u) !== String(userId));
    } else {
      message.isStarred.push(userId);
    }
    await message.save();

    res.status(200).json({ success: true, isStarred: !isStarred });
  } catch (error) {
    console.error("Star Message Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// GET STARRED MESSAGES FOR CURRENT USER
// =====================================
export const getStarredMessages = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all messages starred by this user, across all chats they are members of
    const starredMessages = await Message.find({
      isStarred: userId,
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("sender", "name username profilePic")
      .populate({
        path: "chat",
        select: "chatName isGroup users",
        populate: { path: "users", select: "_id name username" }
      })
      .lean();

    // Authorization guard: only return messages from chats the user is a member of
    const authorizedMessages = starredMessages.filter(msg => {
      if (!msg.chat) return false;
      return msg.chat.users?.some(u => String(u._id) === String(userId));
    });

    res.status(200).json(authorizedMessages);
  } catch (error) {
    console.error("Get Starred Messages Error:", error);
    res.status(500).json({ message: error.message });
  }
};
