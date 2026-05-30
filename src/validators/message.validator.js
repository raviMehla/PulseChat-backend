import { z } from "zod";

// Helper regex to ensure strings are valid 24-character hex MongoDB ObjectIds
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// =====================================
// SEND MESSAGE SCHEMA
// =====================================
export const sendMessageSchema = z.object({
  content: z.string().optional().nullable(),
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  messageType: z.enum(["text", "image", "video", "audio", "voice", "file", "system"]).optional(),
  fileUrl: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  // duration: accept string (e.g. "0:12") or number (seconds) from APK
  duration: z.union([z.string(), z.number()]).optional().nullable(),
  isForwarded: z.boolean().optional(),
  replyTo: z.string()
    .refine(val => val === "" || objectIdRegex.test(val), {
      message: "Invalid replyTo ID format"
    })
    .nullable()
    .optional()
    .transform(val => val === "" ? null : val)
});

// =====================================
// SEARCH MESSAGES SCHEMA
// =====================================
export const searchMessageSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  // Protect the DB from massive regex queries by capping length at 100 chars
  query: z.string()
    .min(1, "Search query cannot be empty")
    .max(100, "Search query is too long")
});

// 🛡️ ARCHITECTURAL UPGRADE: Pagination Validation
// =====================================
export const getMessageHistorySchema = z.object({
  // Ensure the cursor is a valid ISO-8601 datetime string to prevent NoSQL injection on the $lt operator
  cursor: z.string().datetime().optional().nullable(),
  // Limit is passed as a string in query params, but could be parsed as a number. We support both.
  limit: z.union([z.string().regex(/^\d+$/).transform(Number), z.number()]).optional()
});