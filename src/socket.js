import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "./models/User.js";
import Chat from "./models/Chat.js";
import Message from "./models/Message.js";

let io; // Hold the Singleton instance

// 🛡️ ARCHITECTURAL ADDITION: Global Socket Registry
// Maps userId to socketId to track active TCP connections across the Node.js process
export const userSocketMap = {}; 

export const initializeSocket = (server) => {
  // 🛡️ ARCHITECTURAL UPGRADE: Strict Socket CORS Policy
  const allowedOrigins = [
    "http://localhost:5173",
    "https://pulsechat-frontend-three.vercel.app" // ⚠️ REPLACE WITH YOUR EXACT VERCEL URL
  ];

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
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
    
    // Register the active connection in our Global Map
    userSocketMap[String(socket.userId)] = socket.id;

    // Join personal room
    socket.join(String(socket.userId));

    // Broadcast online status to everyone
    try {
      await User.findByIdAndUpdate(socket.userId, { isOnline: true });
      io.emit("user_online", String(socket.userId));
    } catch (err) {
      console.error("Online status update error:", err.message);
    }

    // Auto-join active chats
    try {
      const userChats = await Chat.find({ users: socket.userId }).select("_id");
      userChats.forEach(chat => socket.join(String(chat._id)));
    } catch (error) {
      console.error("Failed to auto-join rooms:", error);
    }

    // ─────────────────────────────────────────────
    // MESSAGING & TYPING EVENTS
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
      } catch (err) {}
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
        await Message.findByIdAndUpdate(messageId, { $addToSet: { deliveredTo: socket.userId } });
        socket.to(String(chatId)).emit("messages_delivered", { chatId: String(chatId), userId: String(socket.userId) });
      } catch (err) {}
    });

    // ─────────────────────────────────────────────
    // WEBRTC SIGNALING (PHASE 1: THE RING)
    // ─────────────────────────────────────────────
    
    // 1. User A initiates a call to User B
    socket.on("call_user", ({ userToCall, from, callerName, type }) => {
      const targetSocketId = userSocketMap[String(userToCall)];
      if (targetSocketId) {
        io.to(targetSocketId).emit("incoming_call", { from, callerName, type });
      } else {
        socket.emit("call_rejected", { reason: "offline" });
      }
    });

    // 🛡️ ARCHITECTURAL FIX: User B Accepts the call!
    socket.on("accept_call", ({ to }) => {
      const targetSocketId = userSocketMap[String(to)];
      if (targetSocketId) {
        // Tells User A to start generating the WebRTC SDP Offer
        io.to(targetSocketId).emit("call_accepted"); 
      }
    });

    // 2. User B declines the call
    socket.on("reject_call", ({ to }) => {
      const targetSocketId = userSocketMap[String(to)];
      if (targetSocketId) {
        io.to(targetSocketId).emit("call_rejected", { reason: "declined" });
      }
    });

    // 3. User A cancels the call before User B answers
    socket.on("cancel_call", ({ to }) => {
      const targetSocketId = userSocketMap[String(to)];
      if (targetSocketId) {
        io.to(targetSocketId).emit("call_cancelled");
      }
    });

    // ─────────────────────────────────────────────
    // WEBRTC SIGNALING (PHASE 2: THE HANDSHAKE)
    // ─────────────────────────────────────────────

    // 🛡️ ARCHITECTURAL FIX: Use 'to' parameter consistently
    socket.on("webrtc_offer", ({ to, sdp }) => {
      const targetSocketId = userSocketMap[String(to)];
      if (targetSocketId) {
        io.to(targetSocketId).emit("webrtc_offer", { from: socket.userId, sdp });
      }
    });

    // Relay the WebRTC SDP Answer (User B -> User A)
    socket.on("webrtc_answer", ({ to, sdp }) => {
      const targetSocketId = userSocketMap[String(to)];
      if (targetSocketId) {
        io.to(targetSocketId).emit("webrtc_answer", { from: socket.userId, sdp });
      }
    });

    // Relay ICE Candidates (Network pathways)
    socket.on("webrtc_ice_candidate", ({ to, candidate }) => {
      const targetSocketId = userSocketMap[String(to)];
      if (targetSocketId) {
        io.to(targetSocketId).emit("webrtc_ice_candidate", { from: socket.userId, candidate });
      }
    });

    // 🔥 DISCONNECT & MEMORY CLEANUP
    socket.on("disconnect", async () => {
      console.log("🔴 Socket disconnected:", socket.userId);
      typingCooldowns.delete(socket.id);
      deliveryCooldowns.delete(socket.id);

      if (userSocketMap[String(socket.userId)] === socket.id) {
        delete userSocketMap[String(socket.userId)];
      }

      try {
        await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen: new Date() });
        io.emit("user_offline", String(socket.userId));
      } catch (err) {}
    });
  });
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized!");
  }
  return io;
};