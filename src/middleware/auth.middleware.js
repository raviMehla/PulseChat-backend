import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    // 1️⃣ Extract token
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // 2️⃣ No token
    if (!token) {
      return res.status(401).json({
        message: "Not authorized, no token"
      });
    }

    // 3️⃣ Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4️⃣ Get user
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        message: "User not found"
      });
    }

    // 5️⃣ Attach user to request
    req.user = user;

    next();

  } catch (error) {
    // 6️⃣ Handle token errors properly
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "jwt expired"
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Invalid token"
      });
    }

    return res.status(401).json({
      message: "Authentication failed"
    });
  }
};