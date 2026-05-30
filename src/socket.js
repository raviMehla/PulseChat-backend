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
  tokenVersion: z.number().optional(),
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
    let remaining = 0;
    if (redisClient) {
      try {
        const luaScript = `
          redis.call('HDEL', KEYS[1], ARGV[1])
          return redis.call('HLEN', KEYS[1])
        `;
        const result = await redisClient.eval(luaScript, {
          keys: [key],
          arguments: [socketId]
        });
        remaining = Number(result);
      } catch (err) {
        console.error("Redis online unregister failed:", err);
        const userSockets = this.localMap.get(userId);
        if (userSockets) {
          userSockets.delete(socketId);
          remaining = userSockets.size;
          if (remaining === 0) {
            this.localMap.delete(userId);
          }
        }
      }
    } else {
      const userSockets = this.localMap.get(userId);
      if (userSockets) {
        userSockets.delete(socketId);
        remaining = userSockets.size;
        if (remaining === 0) {
          this.localMap.delete(userId);
        }
      }
    }
    return remaining;
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

  async setCall(userId, data, durationSec = 30) {
    const key = `call:${userId}`;
    const value = typeof data === "string" ? { targetId: data } : data;
    const strValue = JSON.stringify(value);
    if (redisClient) {
      try {
        await redisClient.set(key, strValue, { EX: durationSec });
      } catch (err) {
        console.error("Redis setCall failed, using local backup:", err);
        this.localMap.set(userId, { data: value, expires: Date.now() + durationSec * 1000 });
      }
    } else {
      this.localMap.set(userId, { data: value, expires: Date.now() + durationSec * 1000 });
    }
  }

  async getCall(userId) {
    const key = `call:${userId}`;
    if (redisClient) {
      try {
        const val = await redisClient.get(key);
        return val ? JSON.parse(val) : null;
      } catch (err) {
        console.error("Redis getCall failed, checking local backup:", err);
      }
    }
    const item = this.localMap.get(userId);
    if (item) {
      if (item.expires > Date.now()) {
        return item.data;
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

const logMissedCall = async (callerId, receiverId, chatId, type) => {
  if (!chatId || !callerId || !receiverId) return;
  try {
    const systemContent = `Missed ${type || "audio"} call`;
    const newMessage = await Message.create({
      chat: chatId,
      sender: callerId, // 📞 Save the caller as sender
      content: systemContent,
      messageType: "system"
    });

    await Chat.findByIdAndUpdate(chatId, {
      $set: { lastMessage: newMessage._id, lastMessageAt: newMessage.createdAt }
    });

    const populated = await Message.findById(newMessage._id).populate("chat sender");
    
    const ioInstance = getIO();
    ioInstance.to(String(callerId)).emit("message_received", populated);
    ioInstance.to(String(receiverId)).emit("message_received", populated);
  } catch (err) {
    console.error("[CALL SYSTEM MESSAGE] Failed to log missed call:", err);
  }
};

const presenceQueue = [];

const processPresenceQueue = async () => {
  if (presenceQueue.length === 0) return;

  const tasks = {};
  while (presenceQueue.length > 0) {
    const task = presenceQueue.shift();
    tasks[task.userId] = { isOnline: task.isOnline, lastSeen: task.lastSeen || new Date() };
  }

  const bulkOps = Object.entries(tasks).map(([userId, state]) => ({
    updateOne: {
      filter: { _id: userId },
      update: { $set: { isOnline: state.isOnline, lastSeen: state.lastSeen } }
    }
  }));

  if (bulkOps.length > 0) {
    try {
      await User.bulkWrite(bulkOps);
    } catch (err) {
      console.error("[PRESENCE WORKER] Failed to execute presence bulkWrite:", err.message);
    }
  }
};

// Run worker loop every 2 seconds
setInterval(processPresenceQueue, 2000);

export const initializeSocket = async (server) => {
  // 🛡️ ARCHITECTURAL UPGRADE: Function-based CORS Policy
  // Mirrors the same logic as server.js HTTP cors() middleware.
  // Mobile apps (React Native / APK) send NO Origin header — the !origin
  // check below allows them through while still blocking unknown web origins.
  const allowedOrigins = [
    "http://localhost:5173",
    "https://go-pulsechat.vercel.app" // ⚠️ REPLACE WITH YOUR EXACT VERCEL URL
  ];

  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        // In production, block all permissive development paths and only allow explicitly whitelisted web origins or empty origin (mobile apps)
        if (process.env.NODE_ENV === "production") {
          if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error("Socket connection blocked by CORS policy."), false);
        }

        // In development, allow local routes and subnets with strict regex validation to prevent CSWSH (Cross-Site WebSocket Hijacking)
        const isLocalHost = /^http:\/\/localhost(:\d+)?$/.test(origin);
        const isLocalIP = /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
        const isPrivateSubnet = /^http:\/\/(192\.168|10)\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin);
        const isLocalFile = /^file:\/\//.test(origin);
        const isNullOrigin = origin === "null";

        if (!origin || 
            isNullOrigin || 
            isLocalFile || 
            isLocalHost || 
            isLocalIP || 
            isPrivateSubnet || 
            allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

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
  io.use(async (socket, next) => {
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
      const userId = validatedPayload.id || validatedPayload.userId || validatedPayload._id;

      // 🛡️ SECURITY: Verify user existence, deletion status, and token version in database
      const user = await User.findById(userId).select("tokenVersion isDeleted");
      if (!user) {
        throw new Error("User not found");
      }
      if (user.isDeleted) {
        throw new Error("Account has been deleted");
      }
      if (validatedPayload.tokenVersion !== undefined && user.tokenVersion !== validatedPayload.tokenVersion) {
        throw new Error("Session expired or revoked");
      }

      socket.userId = userId;
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
  const typingCooldowns = new WeakMap();
  const deliveryCooldowns = new WeakMap();

  // ==========================================
  // CONNECTION LOGIC
  // ==========================================
  io.on("connection", async (socket) => {
    console.log("🟢 Authenticated socket connected:", socket.userId);
    
    // 🛡️ LEVEL 5 FIX: Check token expiration on every incoming socket event packet
    socket.use((packet, next) => {
      try {
        if (!packet || !Array.isArray(packet)) {
          throw new Error("Invalid socket packet format");
        }
        if (socket.tokenExp && socket.tokenExp * 1000 < Date.now()) {
          console.warn(`[SECURITY] Socket event rejected for user ${socket.userId}: Token expired.`);
          socket.disconnect(true);
          // Clear/mutate the packet to prevent downstream handlers from processing it
          packet[0] = "noop";
          packet[1] = null;
          return next(new Error("Token expired"));
        }
        next();
      } catch (err) {
        console.error(`[SECURITY ERROR] Packet validation failure for user ${socket.userId}:`, err.message);
        socket.disconnect(true);
        return next(err);
      }
    });
    
    // 🛡️ LEVEL 7 FIX: Register active socket connection and platform cluster-wide
    const platform = socket.data?.platform || "web";
    await onlineRegistry.register(String(socket.userId), socket.id, platform);

    // Register the active connection in our Global Map
    userSocketMap[String(socket.userId)] = socket.id;

    // Join personal room
    socket.join(String(socket.userId));

    // Broadcast online status to everyone and enqueue presence DB persistence asynchronously
    io.emit("user_online", String(socket.userId));
    presenceQueue.push({ userId: socket.userId, isOnline: true });

    // Auto-join active chats
    try {
      const userChats = await Chat.find({ users: socket.userId }).select("_id");
      userChats.forEach(chat => socket.join(String(chat._id)));
    } catch (error) {
      console.error("Failed to auto-join rooms:", error);
    }

    // 📞 Check for offline missed calls
    try {
      const userDoc = await User.findById(socket.userId).select("lastSeen");
      if (userDoc && userDoc.lastSeen) {
        const previousLastSeen = userDoc.lastSeen;
        
        // Find chats the user is in
        const userChats = await Chat.find({ users: socket.userId }).select("_id");
        const chatIds = userChats.map(c => c._id);
        
        if (chatIds.length > 0) {
          // Find missed calls since they went offline (max 7 days ago, limit 10)
          const missedCalls = await Message.find({
            chat: { $in: chatIds },
            messageType: "system",
            content: { $regex: /^Missed (audio|video) call/i },
            sender: { $ne: socket.userId },
            createdAt: { $gt: previousLastSeen, $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          })
          .sort({ createdAt: 1 })
          .limit(10)
          .populate("sender", "name username profilePic");
          
          if (missedCalls.length > 0) {
            socket.emit("offline_missed_calls", missedCalls.map(m => ({
              _id: m._id,
              chatId: m.chat,
              callerName: m.sender?.name || m.sender?.username || "Someone",
              callerAvatar: m.sender?.profilePic?.url || "",
              type: m.content.toLowerCase().includes("video") ? "video" : "audio",
              createdAt: m.createdAt
            })));
          }
        }
      }
    } catch (err) {
      console.error("[SOCKET] Error checking offline missed calls on connect:", err);
    }

    const handleUserOnlineStatus = async () => {
      console.log("Explicit user_online status update received for:", socket.userId);
      const platform = socket.data?.platform || "mobile";
      await onlineRegistry.register(String(socket.userId), socket.id, platform);
      io.emit("user_online", String(socket.userId));
      presenceQueue.push({ userId: socket.userId, isOnline: true });
    };

    const handleUserOfflineStatus = async () => {
      console.log("Explicit user_offline status update received for:", socket.userId);
      const remaining = await onlineRegistry.unregister(String(socket.userId), socket.id);
      if (remaining === 0) {
        io.emit("user_offline", String(socket.userId));
        presenceQueue.push({ userId: socket.userId, isOnline: false, lastSeen: new Date() });
      }
    };

    socket.on("user-online", handleUserOnlineStatus);
    socket.on("user_online", handleUserOnlineStatus);
    socket.on("user-offline", handleUserOfflineStatus);
    socket.on("user_offline", handleUserOfflineStatus);

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
        // 🛡️ FIX: Only mark messages as delivered that were NOT sent by the joining user.
        // Previously this was pushing socket.userId into deliveredTo for their own messages too,
        // causing the sender to see ✓✓ (delivered) even when the recipient was offline.
        const updated = await Message.updateMany(
          { 
            chat: safeChatId, 
            sender: { $ne: socket.userId },      // Only other people's messages
            deliveredTo: { $ne: socket.userId }  // Not already marked delivered
          },
          { $addToSet: { deliveredTo: socket.userId } }
        );
        if (updated.modifiedCount > 0) {
          io.to(safeChatId).emit("messages_delivered", { chatId: safeChatId, userId: String(socket.userId) });
        }
      } catch (err) {
        console.error("[join_chat] deliveredTo update error:", err);
      }
    }); // end join_chat

    socket.on("typing", ({ chatId }) => {
      if (!chatId) return;
      // 🛡️ Only relay if socket has actually joined this room
      if (!socket.rooms.has(String(chatId))) return;
      const now = Date.now();
      const lastTyped = typingCooldowns.get(socket) || 0;
      if (now - lastTyped < 1000) return; 
      typingCooldowns.set(socket, now);
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
      const lastDelivered = deliveryCooldowns.get(socket) || 0;
      if (now - lastDelivered < 300) return; 
      deliveryCooldowns.set(socket, now);

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
        const callData = { targetId: String(userToCall), chatId, type, status: "ringing", callerId: String(socket.userId) };
        await callRegistry.setCall(String(socket.userId), callData, 30);
        await callRegistry.setCall(String(userToCall), { ...callData, targetId: String(socket.userId) }, 30);
        io.to(String(userToCall)).emit("incoming_call", { from, callerName, type, chatId });
      } else {
        socket.emit("call_rejected", { reason: "offline" });
        await logMissedCall(socket.userId, userToCall, chatId, type);
      }
    });

    // 🛡️ ARCHITECTURAL FIX: User B Accepts the call!
    socket.on("accept_call", async ({ to }) => {
      const activeCall = await callRegistry.getCall(String(socket.userId));
      const chatId = activeCall?.chatId || null;
      const type = activeCall?.type || "audio";
      const callerId = activeCall?.callerId || to;

      const connectedDataA = { targetId: String(to), chatId, type, status: "connected", callerId };
      const connectedDataB = { targetId: String(socket.userId), chatId, type, status: "connected", callerId };

      await callRegistry.setCall(String(socket.userId), connectedDataA, 7200);
      await callRegistry.setCall(String(to), connectedDataB, 7200);
      io.to(String(to)).emit("call_accepted"); 
    });

    // 2. User B declines the call
    socket.on("reject_call", async ({ to }) => {
      const activeCall = await callRegistry.getCall(String(socket.userId));
      if (activeCall && activeCall.status === "ringing") {
        await logMissedCall(activeCall.callerId, socket.userId, activeCall.chatId, activeCall.type);
      }
      await callRegistry.clearCall(String(socket.userId));
      await callRegistry.clearCall(String(to));
      io.to(String(to)).emit("call_rejected", { reason: "declined" });
    });

    // 3. User A cancels the call before User B answers
    socket.on("cancel_call", async ({ to }) => {
      const activeCall = await callRegistry.getCall(String(socket.userId));
      if (activeCall && activeCall.status === "ringing") {
        await logMissedCall(socket.userId, to, activeCall.chatId, activeCall.type);
      }
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

      // Clear local process mapping immediately at the entry point of the handler
      if (userSocketMap[String(socket.userId)] === socket.id) {
        delete userSocketMap[String(socket.userId)];
      }

      // Explicitly evacuate socket rooms to clear intermediate network transport targets immediately
      try {
        for (const room of socket.rooms) {
          if (room !== socket.id) {
            socket.leave(room);
          }
        }
      } catch (err) {
        console.error("Failed to evacuate socket rooms on disconnect:", err);
      }

      typingCooldowns.delete(socket);
      deliveryCooldowns.delete(socket);

      try {
        const activeCall = await callRegistry.getCall(String(socket.userId));
        if (activeCall) {
          const target = activeCall.targetId;
          io.to(target).emit("call_cancelled");
          
          if (activeCall.status === "ringing") {
            const callerId = activeCall.callerId;
            const receiverId = String(socket.userId) === callerId ? target : String(socket.userId);
            await logMissedCall(callerId, receiverId, activeCall.chatId, activeCall.type);
          }
          
          await callRegistry.clearCall(String(socket.userId));
          await callRegistry.clearCall(target);
        }
      } catch (err) {
        console.error("Call clean up on disconnect failed:", err);
      }

      // 🛡️ LEVEL 10 FIX: Atomic unregister and online presence check
      try {
        const remaining = await onlineRegistry.unregister(String(socket.userId), socket.id);

        if (remaining === 0) {
          io.emit("user_offline", String(socket.userId));
          presenceQueue.push({ userId: socket.userId, isOnline: false, lastSeen: new Date() });
        }
      } catch (err) {
        console.error("Disconnect presence check failed:", err);
      }
    });
  });
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized!");
  }
  return io;
};