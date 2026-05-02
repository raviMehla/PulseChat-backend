import { createGroupSchema } from "../validators/chat.validator.js";
import Chat from "../models/Chat.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import { io } from "../server.js";

const createSystemMessage = async (chatId, text) => {
  const message = await Message.create({
    chat: chatId,
    content: text,
    messageType: "system"
  });

  const populated = await Message.findById(message._id)
    .populate("chat");

  io.to(chatId).emit("message_received", populated);
};

// =====================================
// ACCESS OR CREATE 1-TO-1 CHAT
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

    let chat = await Chat.findOne({
      isGroup: false,
      users: { $all: [req.user._id, userId] }
    })
      .populate("users", "-password")
      .populate("lastMessage");

    if (chat) {
      return res.status(200).json(chat);
    }

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
// FETCH USER CHATS
// =====================================
export const fetchChats = async (req, res) => {
  try {
    const chats = await Chat.find({
      users: { $elemMatch: { $eq: req.user._id } }
    })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("lastMessage", "content sender createdAt") // optimized
      .sort({ updatedAt: -1 });

    // ✅ Add unreadCount per user
    const formattedChats = chats.map(chat => {
      return {
        ...chat.toObject(),
        unreadCount:
          chat.unreadCount?.get(req.user._id.toString()) || 0
      };
    });

    res.status(200).json(formattedChats);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// CREATE GROUP CHAT
// =====================================
/*
export const createGroupChat = async (req, res) => {
  try {
    const { name, users } = req.body;

    if (!name || !users || users.length < 2) {
      return res.status(400).json({
        message: "Group must have at least 3 members"
      });
    }

    const groupChat = await Chat.create({
      chatName: name,
      isGroup: true,
      users: [...users, req.user._id],
      groupAdmin: req.user._id
    });

    const fullGroup = await Chat.findById(groupChat._id)
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    res.status(201).json(fullGroup);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
*/

// =====================================
// ADD USER TO GROUP
// =====================================
/*
export const addToGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    const chat = await Chat.findById(chatId);

    if (!chat.isGroup) {
      return res.status(400).json({ message: "Not a group chat" });
    }

    if (chat.groupAdmin.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only admin can add users" });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { $addToSet: { users: userId } },
      { new: true }
    )
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    res.status(200).json(updatedChat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
*/

export const addToGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    const chat = await Chat.findById(chatId);

    if (!chat.isGroup)
      return res.status(400).json({ message: "Not a group chat" });

    if (chat.groupAdmin.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Only admin can add" });

    chat.users.push(userId);
    await chat.save();

    const addedUser = await User.findById(userId);

    await createSystemMessage(
      chatId,
      `${req.user.name} added ${addedUser.name}`
    );

    res.status(200).json({ message: "User added" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// REMOVE USER FROM GROUP
// =====================================

export const removeFromGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    const chat = await Chat.findById(chatId);

    if (!chat)
      return res.status(404).json({ message: "Chat not found" });

    if (!chat.isGroup)
      return res.status(400).json({ message: "Not a group chat" });

    // Only admin can remove
    if (chat.groupAdmin.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Only admin can remove" });

    // Admin cannot remove themselves using remove API
    if (userId === req.user._id.toString())
      return res.status(400).json({
        message: "Admin must use leave group option"
      });

    // Prevent removing current admin
    if (chat.groupAdmin.toString() === userId)
      return res.status(400).json({
        message: "Admin cannot be removed. Admin must leave group instead."
      });

    // Remove user
    chat.users = chat.users.filter(
      user => user.toString() !== userId
    );

    await chat.save();

    const removedUser = await User.findById(userId);

    await createSystemMessage(
      chatId,
      `${removedUser.name} was removed by ${req.user.name}`
    );

    io.to(chatId).emit("group_updated", chat);

    res.status(200).json({ message: "User removed" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// CREATE GROUP CHAT
// =====================================

export const createGroupChat = async (req, res) => {
  try {
    // 1. Zod Validation
    const validation = createGroupSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        message: validation.error.issues[0].message 
      });
    }

    const { name, users } = validation.data;

    // 2. Data Sanitization: Prevent duplicate users and self-addition
    // Convert all incoming IDs to strings, filter out the creator, and use Set for uniqueness
    const creatorId = req.user._id.toString();
    const uniqueParticipants = Array.from(
      new Set(users.filter(id => id !== creatorId))
    );

    if (uniqueParticipants.length < 1) {
      return res.status(400).json({ 
        message: "Group requires at least one other participant" 
      });
    }

    // 3. Add the creator to the final array
    uniqueParticipants.push(creatorId);

    // 4. Create the Group
    const group = await Chat.create({
      chatName: name,
      isGroup: true,
      users: uniqueParticipants,
      groupAdmin: creatorId
    });

    // 5. Populate Data for the Frontend
    const fullGroup = await Chat.findById(group._id)
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    // 6. Generate System Message (Historical Anchor)
    await createSystemMessage(
      group._id,
      `${req.user.name} created the group "${name}"`
    );

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
    const { chatId, newName } = req.body;

    const chat = await Chat.findById(chatId);

    if (!chat.isGroup)
      return res.status(400).json({ message: "Not a group chat" });

    if (chat.groupAdmin.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Only admin can rename" });

    chat.chatName = newName;
    await chat.save();

    await createSystemMessage(
      chatId,
      `${req.user.name} renamed group to ${newName}`
    );

    res.status(200).json(chat);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================
// LEAVE GROUP
// =====================================

export const leaveGroup = async (req, res) => {
  try {
    const { chatId } = req.body;

    const chat = await Chat.findById(chatId);

    if (!chat)
      return res.status(404).json({ message: "Chat not found" });

    if (!chat.isGroup)
      return res.status(400).json({ message: "Not a group chat" });

    const wasAdmin =
      chat.groupAdmin &&
      chat.groupAdmin.toString() === req.user._id.toString();

    // Remove user
    chat.users = chat.users.filter(
      user => user.toString() !== req.user._id.toString()
    );

    // If admin leaves → transfer admin
    if (wasAdmin) {
      if (chat.users.length > 0) {
        chat.groupAdmin = chat.users[0];
      } else {
        chat.groupAdmin = null;
      }
    }

    // If no members left → delete group completely
    if (chat.users.length === 0) {
      await Chat.findByIdAndDelete(chatId);
      return res.status(200).json({ message: "Group deleted (empty)" });
    }

    await chat.save();

    await createSystemMessage(
      chatId,
      `${req.user.name} left the group`
    );

    io.to(chatId).emit("group_updated", chat);

    res.status(200).json({ message: "Left group successfully" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};