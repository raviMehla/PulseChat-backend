import mongoose from "mongoose";
import { 
  accessChatSchema,
  createGroupSchema, 
  renameGroupSchema, 
  groupMembershipSchema, 
  leaveGroupSchema,
  updateGroupDetailsSchema
} from "../validators/chat.validator.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import { getIO } from "../socket.js";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";

// Helper to extract Cloudinary public ID from URL
const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/upload/");
    if (parts.length < 2) return null;
    let path = parts[1];
    const versionMatch = path.match(/^v\d+\/(.+)$/);
    if (versionMatch) {
      path = versionMatch[1];
    }
    const dotIndex = path.lastIndexOf(".");
    if (dotIndex !== -1) {
      path = path.substring(0, dotIndex);
    }
    return path;
  } catch (error) {
    console.error("Failed to parse public_id from URL:", url, error);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// CLOUDINARY UPLOAD HELPER (Buffer → Cloud URL)
// ─────────────────────────────────────────────────────────────
const uploadBufferToCloudinary = (buffer, folder = "pulsechat/avatars") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

// =====================================
// SYSTEM MESSAGE GENERATOR
// =====================================
const createSystemMessage = async (chatId, text, session = null) => {
  const options = session ? { session } : {};
  const message = await Message.create([{
    chat: chatId,
    content: text,
    messageType: "system"
  }], options);

  const msgDoc = message[0];

  // 🛡️ LEVEL 10 FIX: Prevent same-millisecond race conditions using ObjectId chronology check
  await Chat.findOneAndUpdate(
    { 
      _id: chatId, 
      $or: [
        { lastMessage: { $exists: false } }, 
        { lastMessage: null }, 
        { lastMessage: { $lte: msgDoc._id } }
      ] 
    },
    { $set: { lastMessage: msgDoc._id, lastMessageAt: msgDoc.createdAt } },
    options
  );

  const populated = await Message.findById(msgDoc._id)
    .populate("chat")
    .session(session);

  if (session) {
    return populated;
  } else {
    const io = getIO();
    io.to(chatId).emit("message_received", populated);
    return populated;
  }
};

const lastMessageFields = "content messageType fileUrl fileName isDeleted sender createdAt";

// =====================================
// ACCESS OR CREATE 1-TO-1 CHAT
// =====================================
export const accessChat = async (req, res) => {
  try {
    // 1️⃣ Strict Zod Validation
    const validation = accessChatSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { userId } = validation.data;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: "Cannot chat with yourself" });
    }

    // 2️⃣ Check if chat already exists
    let chat = await Chat.findOne({
      isGroup: false,
      users: { $all: [req.user._id, userId] }
    })
      .populate("users", "-password")
      .populate("lastMessage", lastMessageFields);

    if (chat) {
      // If the user had previously "deleted" (hidden) this chat, restore it
      if (chat.hiddenFor?.some(id => String(id) === String(req.user._id))) {
        await Chat.findByIdAndUpdate(chat._id, { $pull: { hiddenFor: req.user._id } });
        chat = await Chat.findById(chat._id).populate("users", "-password").populate("lastMessage", lastMessageFields);
      }
      return res.status(200).json(chat);
    }

    // 3️⃣ 🛡️ PRIVACY ENFORCEMENT: Prevent creating a new chat if blocked
    const [sender, receiver] = await Promise.all([
      User.findById(req.user._id).select("blockedUsers"),
      User.findById(userId).select("blockedUsers")
    ]);

    if (sender.blockedUsers.includes(userId)) {
      return res.status(403).json({ message: "You have blocked this user. Unblock to initiate a chat." });
    }
    if (receiver.blockedUsers.includes(req.user._id)) {
      return res.status(403).json({ message: "Cannot initiate chat with this user at this time." });
    }

    // 4️⃣ Create the new chat
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
// FETCH USER CHATS
// =====================================
export const fetchChats = async (req, res) => {
  try {
    const chats = await Chat.find({
      users: { $elemMatch: { $eq: req.user._id } },
      hiddenFor: { $ne: req.user._id }  // 🛡️ Exclude chats the user has "deleted" (hidden)
    })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("lastMessage", lastMessageFields)
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
// CREATE GROUP CHAT
// =====================================
export const createGroupChat = async (req, res) => {
  try {
    if (typeof req.body.users === "string") {
      try {
        req.body.users = JSON.parse(req.body.users);
      } catch (err) {
        return res.status(400).json({ message: "Invalid users format" });
      }
    }

    const validation = createGroupSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { name, users, description } = validation.data;
    const creatorId = req.user._id.toString();
    const uniqueParticipants = Array.from(new Set(users.filter(id => id !== creatorId)));

    const invalidUserIds = uniqueParticipants.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidUserIds.length > 0) {
      return res.status(400).json({ message: "One or more user IDs are invalid" });
    }

    if (uniqueParticipants.length < 1) {
      return res.status(400).json({ message: "Group requires at least one other participant" });
    }

    // 🛡️ PRIVACY ENFORCEMENT: Validate block status before creating the group
    const adminUser = await User.findById(creatorId).select("blockedUsers");
    const targetUsers = await User.find({ _id: { $in: uniqueParticipants } }).select("blockedUsers");

    for (const targetUser of targetUsers) {
      if (adminUser.blockedUsers.includes(targetUser._id)) {
        return res.status(403).json({ 
          message: "You cannot add a user you have blocked to a group." 
        });
      }
      if (targetUser.blockedUsers.includes(creatorId)) {
        return res.status(403).json({ 
          message: "You do not have permission to add one or more selected users to a group." 
        });
      }
    }

    // Validation passed, add admin to the participants array
    uniqueParticipants.push(creatorId);

    let avatarUrl = "";
    let uploadRes = null;
    if (req.file) {
      uploadRes = await uploadBufferToCloudinary(req.file.buffer, "pulsechat/avatars");
      avatarUrl = uploadRes.secure_url;
    }

    let group;
    try {
      group = await Chat.create({
        chatName: name,
        isGroup: true,
        users: uniqueParticipants,
        groupAdmin: creatorId,
        description: description || "",
        groupAvatar: avatarUrl
      });
    } catch (dbError) {
      if (uploadRes && uploadRes.public_id) {
        cloudinary.uploader.destroy(uploadRes.public_id)
          .catch(err => console.error("Failed to delete orphaned group avatar from Cloudinary:", err));
      }
      throw dbError;
    }

    const fullGroup = await Chat.findById(group._id)
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    await createSystemMessage(group._id, `${req.user.name} created the group "${name}"`);
    res.status(201).json(fullGroup);

  } catch (error) {
    console.error("Create Group Error:", error);
    res.status(500).json({ message: "Internal server error during group creation" });
  }
};

// =====================================
// RENAME GROUP CHAT
// =====================================
/*
export const renameGroup = async (req, res) => {
  try {
    const validation = renameGroupSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: validation.error.issues[0].message });

    const { chatId, newName } = validation.data;
    const chat = await Chat.findById(chatId);

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });
    if (chat.groupAdmin.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Only admin can rename" });

    chat.chatName = newName;
    await chat.save();

    await createSystemMessage(chatId, `${req.user.name} renamed group to "${newName}"`);
    
    const io = getIO();
    io.to(chatId).emit("group_updated", chat);
    res.status(200).json(chat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
*/
// =====================================
// UPDATE GROUP DETAILS (Name & Description)
// =====================================
export const updateGroupDetails = async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: "Invalid chat ID format" });
    }
    
    // 1️⃣ Strict Zod Validation
    const validation = updateGroupDetailsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    // 2️⃣ Fetch Chat & Enforce RBAC (Only Admins can edit)
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Group chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });
    
    if (String(chat.groupAdmin) !== String(req.user._id)) {
      return res.status(403).json({ message: "Only group administrators can update details." });
    }

    // 3️⃣ Apply Updates
    if (validation.data.chatName) chat.chatName = validation.data.chatName;
    if (validation.data.description !== undefined) chat.description = validation.data.description;

    if (req.file) {
      const uploadRes = await uploadBufferToCloudinary(req.file.buffer, "pulsechat/avatars");
      chat.groupAvatar = uploadRes.secure_url;
    }

    await chat.save();
    
    // Announce the change inside the chat
    await createSystemMessage(chatId, `${req.user.name} updated the group details`);

    // Populate necessary fields for the frontend to render correctly
    const updatedChat = await Chat.findById(chatId)
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    // 4️⃣ Real-Time Synchronization via Socket.io
    const io = getIO();
    io.to(chatId).emit("group_updated", updatedChat);

    res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Update Group Details Error:", error);
    res.status(500).json({ message: "Internal server error while updating group details" });
  }
};

// =====================================
// ADD USER TO GROUP
// =====================================
export const addToGroup = async (req, res) => {
  try {
    const validation = groupMembershipSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: validation.error.issues[0].message });

    const { chatId, userId } = validation.data;
    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    const adminId = req.user._id;

    const chat = await Chat.findById(chatId);

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });
    if (chat.groupAdmin.toString() !== adminId.toString()) return res.status(403).json({ message: "Only admin can add" });
    if (chat.users.includes(userId)) return res.status(400).json({ message: "User already in group" });

    // 🛡️ PRIVACY ENFORCEMENT: Bidirectional Block Check for all group members
    const targetUser = await User.findById(userId).select("blockedUsers");
    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const blockedUserIdsStr = targetUser.blockedUsers.map(id => String(id));
    const groupMemberBlockedByTarget = chat.users.some(memberId => blockedUserIdsStr.includes(String(memberId)));
    if (groupMemberBlockedByTarget) {
      return res.status(403).json({ message: "You do not have permission to add this user due to privacy restrictions." });
    }

    const memberBlockingTargetExists = await User.exists({
      _id: { $in: chat.users },
      blockedUsers: userId
    });

    if (memberBlockingTargetExists) {
      return res.status(403).json({ message: "You do not have permission to add this user due to privacy restrictions." });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { $addToSet: { users: userId } },
      { new: true }
    ).populate("users", "-password").populate("groupAdmin", "-password");

    const addedUser = await User.findById(userId);
    await createSystemMessage(chatId, `${req.user.name} added ${addedUser.name}`);
    const io = getIO();
    io.to(chatId).emit("group_updated", updatedChat);
    res.status(200).json(updatedChat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// REMOVE USER FROM GROUP
// =====================================
export const removeFromGroup = async (req, res) => {
  try {
    const validation = groupMembershipSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: validation.error.issues[0].message });

    const { chatId, userId } = validation.data;
    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    const chat = await Chat.findById(chatId);

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });
    if (chat.groupAdmin.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Only admin can remove" });
    if (userId === req.user._id.toString()) return res.status(400).json({ message: "Admin must use leave group option" });

    chat.users = chat.users.filter(user => user.toString() !== userId);
    await chat.save();

    const removedUser = await User.findById(userId);
    await createSystemMessage(chatId, `${removedUser.name} was removed by ${req.user.name}`);

    const updatedChat = await Chat.findById(chatId).populate("users", "-password").populate("groupAdmin", "-password");

    // 🛡️ LEVEL 10 FIX: Isolate the removed user's socket connections before broadcasting the group update
    const io = getIO();
    const targetSockets = await io.in(String(chatId)).fetchSockets();
    for (const targetSocket of targetSockets) {
      if (String(targetSocket.userId) === String(userId)) {
        targetSocket.leave(String(chatId));
      }
    }

    // Emit group update to everyone, and a specific kick event to the removed user
    io.to(chatId).emit("group_updated", updatedChat);
    io.to(userId).emit("kicked_from_group", { chatId });

    res.status(200).json(updatedChat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// LEAVE GROUP
// =====================================
export const leaveGroup = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const validation = leaveGroupSchema.safeParse(req.body);
    if (!validation.success) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { chatId } = validation.data;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid chat ID format" });
    }
    const chat = await Chat.findById(chatId).session(session);

    if (!chat) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Chat not found" });
    }
    if (!chat.isGroup) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Not a group chat" });
    }

    const userIdStr = req.user._id.toString();
    const isMember = chat.users.some(user => user.toString() === userIdStr);
    if (!isMember) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "You are not a member of this group" });
    }

    const wasAdmin = chat.groupAdmin && chat.groupAdmin.toString() === userIdStr;

    // Remove user
    chat.users = chat.users.filter(user => user.toString() !== userIdStr);

    // Admin transfer logic
    if (wasAdmin) {
      if (chat.users.length > 0) {
        chat.groupAdmin = chat.users[0];
      } else {
        chat.groupAdmin = null;
      }
    }

    // Delete if empty
    if (chat.users.length === 0) {
      // Find all media messages in this chat
      const mediaMessages = await Message.find({
        chat: chatId,
        messageType: { $in: ["image", "video", "file"] },
        fileUrl: { $ne: null }
      }).session(session);

      if (mediaMessages.length > 0) {
        const images = [];
        const videos = [];
        const raws = [];

        mediaMessages.forEach((msg) => {
          const publicId = getPublicIdFromUrl(msg.fileUrl);
          if (publicId) {
            if (msg.messageType === "image") images.push(publicId);
            else if (msg.messageType === "video") videos.push(publicId);
            else raws.push(publicId); // "file" -> "raw"
          }
        });

        // Batch delete from Cloudinary
        const deletePromises = [];
        if (images.length > 0) {
          deletePromises.push(
            cloudinary.api.delete_resources(images, { resource_type: "image" })
              .catch(err => console.error("Cloudinary empty group delete images failed:", err))
          );
        }
        if (videos.length > 0) {
          deletePromises.push(
            cloudinary.api.delete_resources(videos, { resource_type: "video" })
              .catch(err => console.error("Cloudinary empty group delete videos failed:", err))
          );
        }
        if (raws.length > 0) {
          deletePromises.push(
            cloudinary.api.delete_resources(raws, { resource_type: "raw" })
              .catch(err => console.error("Cloudinary empty group delete files failed:", err))
          );
        }
        await Promise.all(deletePromises);
      }

      await Message.deleteMany({ chat: chatId }).session(session);
      await Chat.findByIdAndDelete(chatId).session(session);

      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ message: "Group deleted (empty)" });
    }

    await chat.save({ session });
    const systemMsg = await createSystemMessage(chatId, `${req.user.name} left the group`, session);

    await session.commitTransaction();
    session.endSession();

    if (systemMsg) {
      const io = getIO();
      io.to(chatId).emit("message_received", systemMsg);
    }

    const updatedChat = await Chat.findById(chatId).populate("users", "-password").populate("groupAdmin", "-password");
    const io = getIO();
    io.to(chatId).emit("group_updated", updatedChat);

    res.status(200).json({ message: "Left group successfully" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// DELETE / HIDE CHAT
// =====================================
export const deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ message: "Invalid chat ID format" });
    }
    const callerId = req.user._id;
    
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    // 🛡️ Security: Ensure the user requesting deletion is actually part of this chat
    const isMember = chat.users.some(u => String(u) === String(callerId));
    if (!isMember) {
      return res.status(403).json({ message: "Not authorized to delete this chat." });
    }

    const isGroupAdmin = chat.isGroup && String(chat.groupAdmin) === String(callerId);

    if (isGroupAdmin) {
      // Find all media messages in this chat
      const mediaMessages = await Message.find({
        chat: chatId,
        messageType: { $in: ["image", "video", "file"] },
        fileUrl: { $ne: null }
      });

      if (mediaMessages.length > 0) {
        const images = [];
        const videos = [];
        const raws = [];

        mediaMessages.forEach((msg) => {
          const publicId = getPublicIdFromUrl(msg.fileUrl);
          if (publicId) {
            if (msg.messageType === "image") images.push(publicId);
            else if (msg.messageType === "video") videos.push(publicId);
            else raws.push(publicId); // "file" -> "raw"
          }
        });

        // Batch delete from Cloudinary
        const deletePromises = [];
        if (images.length > 0) {
          deletePromises.push(
            cloudinary.api.delete_resources(images, { resource_type: "image" })
              .catch(err => console.error("Cloudinary delete images failed:", err))
          );
        }
        if (videos.length > 0) {
          deletePromises.push(
            cloudinary.api.delete_resources(videos, { resource_type: "video" })
              .catch(err => console.error("Cloudinary delete videos failed:", err))
          );
        }
        if (raws.length > 0) {
          deletePromises.push(
            cloudinary.api.delete_resources(raws, { resource_type: "raw" })
              .catch(err => console.error("Cloudinary delete files failed:", err))
          );
        }
        await Promise.all(deletePromises);
      }

      // Group admin deletes the entire group — hard delete
      await Message.deleteMany({ chat: chatId });
      await Chat.findByIdAndDelete(chatId);

      // Notify all remaining members
      const io = getIO();
      io.to(chatId).emit("group_deleted", { chatId });

      return res.status(200).json({ message: "Group deleted successfully." });
    }

    // For regular members and 1-on-1 chats: soft-delete (hide) for this user only
    await Chat.findByIdAndUpdate(chatId, {
      $addToSet: { hiddenFor: callerId },
      $set: { [`unreadCount.${String(callerId)}`]: 0 }
    });

    res.status(200).json({ message: "Chat removed from your list." });
  } catch (error) {
    console.error("Delete Chat Error:", error);
    res.status(500).json({ message: "Internal server error during chat deletion." });
  }
};

// =====================================
// PROMOTE MEMBER TO ADMIN
// =====================================
export const promoteToAdmin = async (req, res) => {
  try {
    const validation = groupMembershipSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: validation.error.issues[0].message });

    const { chatId, userId } = validation.data;
    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    const chat = await Chat.findById(chatId);

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });
    if (chat.groupAdmin.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the current group admin can promote others." });
    }
    if (!chat.users.includes(userId)) {
      return res.status(400).json({ message: "User is not a member of this group" });
    }

    chat.groupAdmin = userId;
    await chat.save();

    const promotedUser = await User.findById(userId);
    await createSystemMessage(chatId, `${promotedUser.name} was promoted to Group Admin by ${req.user.name}`);

    const updatedChat = await Chat.findById(chatId)
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    const io = getIO();
    io.to(chatId).emit("group_updated", updatedChat);

    res.status(200).json(updatedChat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

