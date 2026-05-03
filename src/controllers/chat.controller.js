import { 
  createGroupSchema, 
  renameGroupSchema, 
  groupMembershipSchema, 
  leaveGroupSchema 
} from "../validators/chat.validator.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import { getIO } from "../socket.js";

// =====================================
// SYSTEM MESSAGE GENERATOR
// =====================================
const createSystemMessage = async (chatId, text) => {
  const message = await Message.create({
    chat: chatId,
    content: text,
    messageType: "system"
  });

  const populated = await Message.findById(message._id).populate("chat");
  const io = getIO();
  io.to(chatId).emit("message_received", populated);
};

// =====================================
// ACCESS OR CREATE 1-TO-1 CHAT
// =====================================
export const accessChat = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ message: "UserId is required" });
    if (userId === req.user._id.toString()) return res.status(400).json({ message: "Cannot chat with yourself" });

    // 1️⃣ Check if chat already exists
    let chat = await Chat.findOne({
      isGroup: false,
      users: { $all: [req.user._id, userId] }
    })
      .populate("users", "-password")
      .populate("lastMessage");

    if (chat) return res.status(200).json(chat);

    // 2️⃣ 🛡️ PRIVACY ENFORCEMENT: Prevent creating a new chat if blocked
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

    // 3️⃣ Create the new chat
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
// CREATE GROUP CHAT
// =====================================
export const createGroupChat = async (req, res) => {
  try {
    const validation = createGroupSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: validation.error.issues[0].message });
    }

    const { name, users } = validation.data;
    const creatorId = req.user._id.toString();
    const uniqueParticipants = Array.from(new Set(users.filter(id => id !== creatorId)));

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

    const group = await Chat.create({
      chatName: name,
      isGroup: true,
      users: uniqueParticipants,
      groupAdmin: creatorId
    });

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

// =====================================
// ADD USER TO GROUP
// =====================================
export const addToGroup = async (req, res) => {
  try {
    const validation = groupMembershipSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: validation.error.issues[0].message });

    const { chatId, userId } = validation.data;
    const adminId = req.user._id;

    const chat = await Chat.findById(chatId);

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });
    if (chat.groupAdmin.toString() !== adminId.toString()) return res.status(403).json({ message: "Only admin can add" });
    if (chat.users.includes(userId)) return res.status(400).json({ message: "User already in group" });

    // 🛡️ PRIVACY ENFORCEMENT: Block Check
    const [adminUser, targetUser] = await Promise.all([
      User.findById(adminId).select("blockedUsers"),
      User.findById(userId).select("blockedUsers")
    ]);

    if (adminUser.blockedUsers.includes(userId)) {
      return res.status(403).json({ message: "You cannot add a user you have blocked." });
    }
    if (targetUser.blockedUsers.includes(adminId)) {
      return res.status(403).json({ message: "You do not have permission to add this user." });
    }

    chat.users.push(userId);
    await chat.save();

    const addedUser = await User.findById(userId);
    await createSystemMessage(chatId, `${req.user.name} added ${addedUser.name}`);

    const updatedChat = await Chat.findById(chatId).populate("users", "-password").populate("groupAdmin", "-password");
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

    // Emit group update to everyone, and a specific kick event to the removed user
    const io = getIO();
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
  try {
    const validation = leaveGroupSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ message: validation.error.issues[0].message });

    const { chatId } = validation.data;
    const chat = await Chat.findById(chatId);

    if (!chat) return res.status(404).json({ message: "Chat not found" });
    if (!chat.isGroup) return res.status(400).json({ message: "Not a group chat" });

    const wasAdmin = chat.groupAdmin && chat.groupAdmin.toString() === req.user._id.toString();

    // Remove user
    chat.users = chat.users.filter(user => user.toString() !== req.user._id.toString());

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
      await Chat.findByIdAndDelete(chatId);
      return res.status(200).json({ message: "Group deleted (empty)" });
    }

    await chat.save();
    await createSystemMessage(chatId, `${req.user.name} left the group`);

    const updatedChat = await Chat.findById(chatId).populate("users", "-password").populate("groupAdmin", "-password");
    const io = getIO();
    io.to(chatId).emit("group_updated", updatedChat);

    res.status(200).json({ message: "Left group successfully" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};