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
    if (!token) return next(new Error("Authentication error"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (err) {
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
    console.log("Authenticated socket:", socket.userId);
    socket.join(socket.userId);

    try {
      await User.findByIdAndUpdate(socket.userId, { isOnline: true });
    } catch (err) {
      console.log("Online update error:", err.message);
    }
    io.emit("user_online", socket.userId);

    // 🔥 AUTO-JOIN ARCHITECTURE
    try {
      const userChats = await Chat.find({ users: socket.userId }).select("_id");
      userChats.forEach(chat => socket.join(chat._id.toString()));
    } catch (error) {
      console.error("Failed to auto-join rooms:", error);
    }

    // ─────────────────────────────────────────────
    // EVENT LISTENERS
    // ─────────────────────────────────────────────
    socket.on("join_chat", async (chatId) => {
      socket.join(chatId);
      await Message.updateMany(
        { chat: chatId, sender: { $ne: socket.userId }, deliveredTo: { $ne: socket.userId } },
        { $push: { deliveredTo: socket.userId } }
      );
      io.to(chatId).emit("messages_delivered", { chatId, userId: socket.userId });
    });

    socket.on("typing", ({ chatId }) => {
      const now = Date.now();
      const lastTyped = typingCooldowns.get(socket.id) || 0;
      if (now - lastTyped < 1000) return; 
      typingCooldowns.set(socket.id, now);
      socket.to(chatId).emit("typing", { userId: socket.userId });
    });

    socket.on("stop_typing", ({ chatId }) => {
      socket.to(chatId).emit("stop_typing", { userId: socket.userId });
    });

    socket.on("message_delivered", async ({ messageId, chatId }) => {
      const now = Date.now();
      const lastDelivered = deliveryCooldowns.get(socket.id) || 0;
      if (now - lastDelivered < 300) return; 
      deliveryCooldowns.set(socket.id, now);

      try {
        await Message.findByIdAndUpdate(messageId, {
          $addToSet: { deliveredTo: socket.userId }
        });
        socket.to(chatId).emit("messages_delivered", { chatId, userId: socket.userId });
      } catch (err) {
        console.error("Delivery receipt error:", err.message);
      }
    });

    // 🔥 DISCONNECT & MEMORY CLEANUP
    socket.on("disconnect", async () => {
      console.log("Socket disconnected:", socket.userId);
      typingCooldowns.delete(socket.id);
      deliveryCooldowns.delete(socket.id);

      try {
        await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen: new Date() });
      } catch (err) {
        console.log("Offline update error:", err.message);
      }
      io.emit("user_offline", socket.userId);
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