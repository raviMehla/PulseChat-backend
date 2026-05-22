import multer from "multer";

// Use memory storage because we are piping directly to Cloudinary via streamifier
const storage = multer.memoryStorage();

const allowedExtensionsForOctetStream = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "zip",
]);

const getExtension = (fileName = "") => {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match?.[1]?.toLowerCase() || "";
};

// 🛡️ SECURITY: MIME type whitelist — only explicitly approved types are accepted
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // ── Images ──
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",

    // ── Video ──
    "video/mp4",
    "video/webm",
    "video/quicktime",       // .mov (iOS camera output)
    "video/x-m4v",

    // ── Documents ──
    "application/pdf",
    "application/x-pdf",
    "application/msword",    // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  // .docx
    "application/vnd.ms-excel",  // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",        // .xlsx
    "application/vnd.ms-powerpoint",  // .ppt
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
    "text/plain",            // .txt
    "text/csv",
    "application/csv",
    "application/zip",       // .zip
    "application/x-zip-compressed",   // .zip (alternate MIME)
  ];

  const isAllowedMime = allowedMimeTypes.includes(file.mimetype);
  const isSafeOctetStream =
    file.mimetype === "application/octet-stream" &&
    allowedExtensionsForOctetStream.has(getExtension(file.originalname));

  if (isAllowedMime || isSafeOctetStream) {
    cb(null, true);
  } else {
    const error = new Error(`SECURITY_BLOCKED: File type "${file.mimetype}" is not allowed.`);
    error.statusCode = 415;
    cb(error, false);
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
