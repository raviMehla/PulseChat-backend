import multer from "multer";

// Use memory storage because we are piping directly to Cloudinary via streamifier
const storage = multer.memoryStorage();

// 🛡️ SECURITY: Strict MIME type checking
const fileFilter = (req, file, cb) => {
  // Define exactly what your app supports. Reject EVERYTHING else.
  const allowedMimeTypes = [
    "image/jpeg", 
    "image/png", 
    "image/webp", 
    "image/gif",
    "video/mp4",
    "video/webm"
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    // Pass an error back to the Express error handler
    cb(new Error("SECURITY_BLOCKED: Invalid file type. Only JPG, PNG, WEBP, GIF, MP4, and WEBM are allowed."), false);
  }
};

export const upload = multer({
  storage,
  limits: {
    // 🛡️ SECURITY: Hard cap file size to prevent memory exhaustion
    fileSize: 10 * 1024 * 1024, // 10 Megabytes max
    files: 1 // Only allow 1 file per request
  },
  fileFilter,
});