
import express from "express";
import dotenv from "dotenv";

import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import http from "http";
import { Server } from "socket.io";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import messageRoutes from "./routes/message.routes.js";
import connectDB from "./config/db.js";
import jwt from "jsonwebtoken";
import User from "./models/User.js";
import Message from "./models/Message.js";
import chatRoutes from "./routes/chat.routes.js";
import { errorHandler } from "./middleware/error.middleware.js";
import rateLimit from "express-rate-limit";





// Load environment variables
dotenv.config();
import "./config/firebase.js";
  
// Connect Database
connectDB();

// Initialize Express app
const app = express();

// Create HTTP server (required for socket.io)
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});

// app.use(limiter);
app.use("/api/auth", limiter);


export { io };

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication error"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});


// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(compression());
app.use(errorHandler);

//Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
// app.use("/api", messageRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);



// Basic Route (Health Check)
app.get("/", (req, res) => {
  res.status(200).json({
    status: "Server running successfully ",
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME
  });
});

io.on("connection", async (socket) => {
  console.log("Authenticated socket:", socket.userId);

  socket.join(socket.userId);

  try {
    await User.findByIdAndUpdate(socket.userId, {
      isOnline: true
    });
    console.log("Marked online:", socket.userId);
  } catch (err) {
    console.log("Online update error:", err.message);
  }

  io.emit("user_online", socket.userId);
  console.log("Emitted user_online");

  socket.on("join_chat", async (chatId) => {
  socket.join(chatId);

  // Mark messages as delivered
  await Message.updateMany(
    {
      chat: chatId,
      sender: { $ne: socket.userId },
      deliveredTo: { $ne: socket.userId }
    },
    {
      $push: { deliveredTo: socket.userId }
    }
  );

  io.to(chatId).emit("messages_delivered", {
    chatId,
    userId: socket.userId
  });

  console.log("User joined chat:", chatId);
  });

  // 🔥 TYPING START
  socket.on("typing", ({ chatId }) => {
  console.log("Typing received:", chatId);

  socket.to(chatId).emit("typing", {
    userId: socket.userId
  });
  });

// 🔥 TYPING STOP
  socket.on("stop_typing", ({ chatId }) => {
  socket.to(chatId).emit("stop_typing", {
    userId: socket.userId
  });
  });

  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.userId);

    try {
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date()
      });
      console.log("Marked offline:", socket.userId);
    } catch (err) {
      console.log("Offline update error:", err.message);
    }

    io.emit("user_offline", socket.userId);
    console.log("Emitted user_offline");
  });

});


/*
io.on("connection", async (socket) => {
  console.log("Authenticated socket:", socket.userId);

  socket.join(socket.userId);

  // Mark user online
  await User.findByIdAndUpdate(socket.userId, {
    isOnline: true
  });

  io.emit("user_online", socket.userId);

  socket.on("join_chat", (chatId) => {
    socket.join(chatId);
    console.log("User joined chat:", chatId);
  });

  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.userId);

    await User.findByIdAndUpdate(socket.userId, {
      isOnline: false,
      lastSeen: new Date()
    });

    io.emit("user_offline", socket.userId);
  });
});
*/

/*
// Socket.IO basic connection
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // User setup
  socket.on("setup", (userId) => {
    socket.join(userId);
    console.log("User joined room:", userId);
  });

  // Join specific chat room
  socket.on("join_chat", (chatId) => {
    socket.join(chatId);
    console.log("User joined chat:", chatId);
  });

  // Send message
  socket.on("new_message", (messageData) => {
    const chat = messageData.chat;

    if (!chat.users) return;

    chat.users.forEach((user) => {
      if (user._id === messageData.sender._id) return;

      io.to(user._id).emit("message_received", messageData);
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});
*/
/*
io.on("connection", (socket) => {
  console.log("Authenticated socket:", socket.userId);

  // Auto join personal room
  socket.join(socket.userId);

  // Join chat room
  socket.on("join_chat", (chatId) => {
    socket.join(chatId);
    console.log("User joined chat:", chatId);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.userId);
  });
});
*/

// Start Server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});