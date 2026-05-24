import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import { z } from "zod";
import User from "./models/User.js";
import Chat from "./models/Chat.js";
import Message from "./models/Message.js";

let io; // Hold the Singleton instance

// 🛡️ ARCHITECTURAL ADDITION: Global Socket Registry
// Maps userId to socketId to track active TCP connections across the Node.js process
export const userSocketMap = {}; 

const tokenPayloadSchema = z.object({
  id: z.string().optional(),
  userId: z.string().optional(),
  _id: z.string().optional(),
  exp: z.number()
}).refine(data => data.id || data.userId || data._id, {
  message: "Token must contain a valid user identifier"
});

class OnlineRegistry {
  constructor() {
    this.localMap = new Map();
  }

  async register(userId, socketId, platform) {
    const key = `online:${userId}`;
    if (redisClient) {
      try {
        await redisClient.hSet(key, socketId, platform);
        await redisClient.expire(key, 86400); // 24-hour safety expiry
      } catch (err) {
        console.error("Redis online register failed:", err);
      }
    }
    if (!this.localMap.has(userId)) {
      this.localMap.set(userId, new Map());
    }
    this.localMap.get(userId).set(socketId, platform);
  }

  async unregister(userId, socketId) {
    const key = `online:${userId}`;
    if (redisClient) {
      try {
        await redisClient.hDel(key, socketId);
      } catch (err) {
        console.error("Redis online unregister failed:", err);
      }
    }
    const userSockets = this.localMap.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.localMap.delete(userId);
      }
    }
  }

  async getPlatforms(userId) {
    const key = `online:${userId}`;
    if (redisClient) {
      try {
        const vals = await redisClient.hVals(key);
        if (vals && vals.length > 0) return vals;
      } catch (err) {
        console.error("Redis getPlatforms failed:", err);
      }
    }
    const userSockets = this.localMap.get(userId);
    if (userSockets) {
      return Array.from(userSockets.values());
    }
    return [];
  }
}

export const onlineRegistry = new OnlineRegistry();

let redisClient = null;

class CallRegistry {
  constructor() {
    this.localMap = new Map();
  }

  async setCall(userId, targetId, durationSec = 30) {
    const key = `call:${userId}`;
    if (redisClient) {
      try {
        await redisClient.set(key, targetId, { EX: durationSec });
      } catch (err) {
        console.error("Redis setCall failed, using local backup:", err);
        this.localMap.set(userId, { targetId, expires: Date.now() + durationSec * 1000 });
      }
    } else {
      this.localMap.set(userId, { targetId, expires: Date.now() + durationSec * 1000 });
    }
  }

  async getCall(userId) {
    const key = `call:${userId}`;
    if (redisClient) {
      try {
        return await redisClient.get(key);
      } catch (err) {
        console.error("Redis getCall failed, checking local backup:", err);
      }
    }
    const item = this.localMap.get(userId);
    if (item) {
      if (item.expires > Date.now()) {
        return item.targetId;
      }
      this.localMap.delete(userId);
    }
    return null;
  }

  async clearCall(userId) {
    const key = `call:${userId}`;
    if (redisClient) {
      try {
        await redisClient.del(key);
      } catch (err) {
        console.error("Redis clearCall failed, clearing local backup:", err);
      }
    }
    this.localMap.delete(userId);
  }
}

export const callRegistry = new CallRegistry();

export const initializeSocket = async (server) => {
  // 🛡️ ARCHITECTURAL UPGRADE: Function-based CORS Policy
  // Mirrors the same logic as server.js HTTP cors() middleware.
  // Mobile apps (React Native / APK) send NO Origin header — the !origin
  // check below allows them through while still blocking unknown web origins.
  const allowedOrigins = [
    "http://localhost:5173",
    "https://pulsechat-frontend-three.vercel.app" // ⚠️ REPLACE WITH YOUR EXACT VERCEL URL
  ];

  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, curl, etc.) or local development/simulators
        if (!origin || 
            origin === "null" || 
            origin.startsWith("file://") || 
            origin.startsWith("http://localhost") || 
            origin.startsWith("http://127.0.0.1") || 
            origin.startsWith("http://192.168.") || 
            origin.startsWith("http://10.")) {
          return callback(null, true);
        }

        // Allow known web origins
        if (allowedOrigins.includes(origin)) return callback(null, true);

        // Block everything else
        return callback(new Error("Socket connection blocked by CORS policy."), false);
      },
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // 🛡️ LEVEL 1 FIX: Attach Redis Adapter for Horizontal Scaling
  if (process.env.REDIS_URI) {
    try {
      const pubClient = createClient({ url: process.env.REDIS_URI });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      redisClient = pubClient;
      console.log("🟢 Redis Adapter connected for Socket.io Scaling");
    } catch (error) {
      console.error("🔴 Redis connection failed. Falling back to in-memory:", error);
    }
  }

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
      
      // Enforce strict schema validation using Zod
      const parseResult = tokenPayloadSchema.safeParse(decoded);
      if (!parseResult.success) {
        throw new Error(parseResult.error.issues[0]?.message || "Malformed JWT payload");
      }

      const validatedPayload = parseResult.data;
      socket.userId = validatedPayload.id || validatedPayload.userId || validatedPayload._id;
      socket.tokenExp = validatedPayload.exp;
      socket.data = socket.data || {};
      socket.data.platform = socket.handshake.auth?.platform || "web";
      
      next();
    } catch (err) {
      console.error("Socket authentication failed:", err.message);
      next(new Error(err.message || "Invalid token"));
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
    
    // 🛡️ LEVEL 5 FIX: Check token expiration on every incoming socket event packet
    socket.use((packet, next) => {
      if (socket.tokenExp && socket.tokenExp * 1000 < Date.now()) {
        console.warn(`[SECURITY] Socket event rejected for user ${socket.userId}: Token expired.`);
        socket.disconnect(true);
        return next(new Error("Token expired"));
      }
      next();
    });
    
    // 🛡️ LEVEL 7 FIX: Register active socket connection and platform cluster-wide
    const platform = socket.data?.platform || "web";
    await onlineRegistry.register(String(socket.userId), socket.id, platform);

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

      // 🛡️ SECURITY: Verify the socket's authenticated user is actually a member of this chat
      try {
        const isMember = await Chat.exists({ _id: safeChatId, users: socket.userId });
        if (!isMember) {
          console.warn(`[SOCKET] join_chat REJECTED: User ${socket.userId} is not a member of chat ${safeChatId}`);
          return;
        }
      } catch (err) {
        console.error("[SOCKET] join_chat membership check failed:", err.message);
        return;
      }

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
      // 🛡️ Only relay if socket has actually joined this room
      if (!socket.rooms.has(String(chatId))) return;
      const now = Date.now();
      const lastTyped = typingCooldowns.get(socket.id) || 0;
      if (now - lastTyped < 1000) return; 
      typingCooldowns.set(socket.id, now);
      socket.to(String(chatId)).emit("typing", { userId: String(socket.userId) });
    });

    socket.on("stop_typing", ({ chatId }) => {
      if (!chatId) return;
      // 🛡️ Only relay if socket has actually joined this room
      if (!socket.rooms.has(String(chatId))) return;
      socket.to(String(chatId)).emit("stop_typing", { userId: String(socket.userId) });
    });

    socket.on("message_delivered", async ({ messageId, chatId }) => {
      if (!messageId || !chatId) return;
      // 🛡️ Only relay if socket has actually joined this room
      if (!socket.rooms.has(String(chatId))) return;
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
    socket.on("call_user", async ({ userToCall, from, callerName, type, chatId }) => {
      // 🛡️ LEVEL 1 SECURITY FIX: Validate they are actually in a shared chat!
      try {
        const isMember = await Chat.exists({ _id: chatId, users: socket.userId });
        if (!isMember) {
          console.warn(`[SECURITY] Blocked unauthorized call attempt from ${socket.userId}`);
          return;
        }
      } catch (err) {
        return;
      }

      const targetSockets = await io.in(String(userToCall)).fetchSockets();
      if (targetSockets.length > 0) {
        await callRegistry.setCall(String(socket.userId), String(userToCall), 30);
        await callRegistry.setCall(String(userToCall), String(socket.userId), 30);
        io.to(String(userToCall)).emit("incoming_call", { from, callerName, type, chatId });
      } else {
        socket.emit("call_rejected", { reason: "offline" });
      }
    });

    // 🛡️ ARCHITECTURAL FIX: User B Accepts the call!
    socket.on("accept_call", async ({ to }) => {
      await callRegistry.setCall(String(socket.userId), String(to), 7200);
      await callRegistry.setCall(String(to), String(socket.userId), 7200);
      io.to(String(to)).emit("call_accepted"); 
    });

    // 2. User B declines the call
    socket.on("reject_call", async ({ to }) => {
      await callRegistry.clearCall(String(socket.userId));
      await callRegistry.clearCall(String(to));
      io.to(String(to)).emit("call_rejected", { reason: "declined" });
    });

    // 3. User A cancels the call before User B answers
    socket.on("cancel_call", async ({ to }) => {
      await callRegistry.clearCall(String(socket.userId));
      await callRegistry.clearCall(String(to));
      io.to(String(to)).emit("call_cancelled");
    });

    // ─────────────────────────────────────────────
    // WEBRTC SIGNALING (PHASE 2: THE HANDSHAKE)
    // ─────────────────────────────────────────────

    // 🛡️ ARCHITECTURAL FIX: Use 'to' parameter consistently
    socket.on("webrtc_offer", ({ to, sdp }) => {
      io.to(String(to)).emit("webrtc_offer", { from: socket.userId, sdp });
    });

    // Relay the WebRTC SDP Answer (User B -> User A)
    socket.on("webrtc_answer", ({ to, sdp }) => {
      io.to(String(to)).emit("webrtc_answer", { from: socket.userId, sdp });
    });

    // Relay ICE Candidates (Network pathways)
    socket.on("webrtc_ice_candidate", ({ to, candidate }) => {
      io.to(String(to)).emit("webrtc_ice_candidate", { from: socket.userId, candidate });
    });

    // 🔥 DISCONNECT & MEMORY CLEANUP
    socket.on("disconnect", async () => {
      console.log("🔴 Socket disconnected:", socket.userId);
      typingCooldowns.delete(socket.id);
      deliveryCooldowns.delete(socket.id);

      try {
        const activeCallTarget = await callRegistry.getCall(String(socket.userId));
        if (activeCallTarget) {
          io.to(activeCallTarget).emit("call_cancelled");
          await callRegistry.clearCall(String(socket.userId));
          await callRegistry.clearCall(activeCallTarget);
        }
      } catch (err) {
        console.error("Call clean up on disconnect failed:", err);
      }

      // 🛡️ LEVEL 7 FIX: Unregister from cluster-wide registry
      await onlineRegistry.unregister(String(socket.userId), socket.id);

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