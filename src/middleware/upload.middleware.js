import multer from "multer";

// Use memory storage because we are piping directly to Cloudinary via streamifier
const storage = multer.memoryStorage();

// 🛡️ SECURITY: MIME type whitelist — only explicitly approved types are accepted
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // ── Images ──
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",

    // ── Video ──
    "video/mp4",
    "video/webm",
    "video/quicktime",       // .mov (iOS camera output)

    // ── Documents ──
    "application/pdf",
    "application/msword",    // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  // .docx
    "application/vnd.ms-excel",  // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",        // .xlsx
    "application/vnd.ms-powerpoint",  // .ppt
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
    "text/plain",            // .txt
    "application/zip",       // .zip
    "application/x-zip-compressed",   // .zip (alternate MIME)
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`SECURITY_BLOCKED: File type "${file.mimetype}" is not allowed.`), false);
  }
};

export const upload = multer({
  storage,
  limits: {
    // 🛡️ SECURITY: 25MB cap — covers HD images, short videos, and large documents
    fileSize: 25 * 1024 * 1024,
    files: 1
  },
  fileFilter,
});