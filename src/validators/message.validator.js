import { z } from "zod";

// Helper regex to ensure strings are valid 24-character hex MongoDB ObjectIds
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// =====================================
// SEND MESSAGE SCHEMA
// =====================================
export const sendMessageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty"),
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  // Gracefully handle undefined, null, or empty strings
  replyTo: z.string()
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