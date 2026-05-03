import "dotenv/config";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import http from "http";

// Config & DB
import connectDB from "./config/db.js";
import "./config/firebase.js";

// Routes
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import messageRoutes from "./routes/message.routes.js";
import chatRoutes from "./routes/chat.routes.js";

// Middleware
import { errorHandler } from "./middleware/error.middleware.js";
import { globalLimiter } from "./middleware/rateLimit.middleware.js";

// 🔥 Import the Modular Socket Engine
import { initializeSocket } from "./socket.js";

// Load environment variables
dotenv.config();

// Connect Database
connectDB();

// Initialize Express app
const app = express();

// 🛡️ ARCHITECTURAL FIX: Trust Render's Reverse Proxy for accurate Rate Limiting
app.set("trust proxy", 1);

// Create HTTP server
const server = http.createServer(app);

// 🔥 Boot up the Socket.IO Engine
initializeSocket(server);

// ==========================================
// EXPRESS MIDDLEWARE PIPELINE
// ==========================================
app.use(express.json());
app.use(cors());
app.use(helmet()); 
app.use(morgan("dev")); 
app.use(compression()); 

// Global Rate Limiter
app.use("/api", globalLimiter);

// ==========================================
// API ROUTES
// ==========================================
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);

// Health Check
app.get("/", (req, res) => {
  res.status(200).json({
    status: "Server running successfully",
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME
  });
});

// 🚨 ERROR HANDLER MUST BE LAST
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`HTTP and WebSocket Server running on port ${PORT}`);
});