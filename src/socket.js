import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "./models/User.js";
import Chat from "./models/Chat.js";
import Message from "./models/Message.js";

let io; // Hold the Singleton instance

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Update this to your specific frontend URL in production
      methods: ["GET", "POST"]
    }
  });

  // ==========================================
  // SOCKET.IO AUTHENTICATION
  // ==========================================
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      console.warn("Socket connection rejected: No token provided.");
      return next(new Error("Authentication error"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // 🛡️ FIX: Agnostic ID parsing to prevent undefined userId crashes
      socket.userId = decoded.id || decoded.userId || decoded._id;
      
      if (!socket.userId) throw new Error("Malformed JWT payload");
      next();
    } catch (err) {
      console.error("Socket authentication failed:", err.message);
      next(new Error("Invalid token"));
    }
  });

  // ==========================================
  // IN-MEMORY THROTTLING (Anti-Spam)
  // ==========================================
  const typingCooldowns = new Map();
  const deliveryCooldowns = new Map();

  // ==========================================
  // CONNECTION LOGIC
  // ==========================================
  io.on("connection", async (socket) => {
    console.log("🟢 Authenticated socket connected:", socket.userId);
    
    // Join a personal room for direct user-to-user events (like getting kicked from a group)
    socket.join(String(socket.userId));

    // Broadcast online status to everyone
    try {
      await User.findByIdAndUpdate(socket.userId, { isOnline: true });
      io.emit("user_online", String(socket.userId));
    } catch (err) {
      console.error("Online status update error:", err.message);
    }

    // 🔥 AUTO-JOIN ARCHITECTURE
    try {
      const userChats = await Chat.find({ users: socket.userId }).select("_id");
      userChats.forEach(chat => socket.join(String(chat._id)));
    } catch (error) {
      console.error("Failed to auto-join rooms:", error);
    }

    // ─────────────────────────────────────────────
    // EVENT LISTENERS
    // ─────────────────────────────────────────────
    socket.on("join_chat", async (chatId) => {
      if (!chatId) return;
      const safeChatId = String(chatId);
      socket.join(safeChatId);
      
      try {
        await Message.updateMany(
          { chat: safeChatId, sender: { $ne: socket.userId }, deliveredTo: { $ne: socket.userId } },
          { $push: { deliveredTo: socket.userId } }
        );
        io.to(safeChatId).emit("messages_delivered", { chatId: safeChatId, userId: String(socket.userId) });
      } catch (err) {
        console.error("Join chat delivery update error:", err.message);
      }
    });

    socket.on("typing", ({ chatId }) => {
      if (!chatId) return;
      const now = Date.now();
      const lastTyped = typingCooldowns.get(socket.id) || 0;
      if (now - lastTyped < 1000) return; 
      typingCooldowns.set(socket.id, now);
      socket.to(String(chatId)).emit("typing", { userId: String(socket.userId) });
    });

    socket.on("stop_typing", ({ chatId }) => {
      if (!chatId) return;
      socket.to(String(chatId)).emit("stop_typing", { userId: String(socket.userId) });
    });

    socket.on("message_delivered", async ({ messageId, chatId }) => {
      if (!messageId || !chatId) return;
      const now = Date.now();
      const lastDelivered = deliveryCooldowns.get(socket.id) || 0;
      if (now - lastDelivered < 300) return; 
      deliveryCooldowns.set(socket.id, now);

      try {
        await Message.findByIdAndUpdate(messageId, {
          $addToSet: { deliveredTo: socket.userId }
        });
        socket.to(String(chatId)).emit("messages_delivered", { chatId: String(chatId), userId: String(socket.userId) });
      } catch (err) {
        console.error("Delivery receipt error:", err.message);
      }
    });

    // 🔥 DISCONNECT & MEMORY CLEANUP
    socket.on("disconnect", async () => {
      console.log("🔴 Socket disconnected:", socket.userId);
      typingCooldowns.delete(socket.id);
      deliveryCooldowns.delete(socket.id);

      try {
        await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen: new Date() });
        io.emit("user_offline", String(socket.userId));
      } catch (err) {
        console.error("Offline update error:", err.message);
      }
    });
  });
};

// 🔥 Helper to export the io instance to controllers
export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized!");
  }
  return io;
};