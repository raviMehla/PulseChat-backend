import { z } from "zod";

export const sendMessageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty"),
  chatId: z.string().min(1, "ChatId required"),
  // 🔥 FIX: Gracefully handle undefined, null, or empty strings
  replyTo: z.string().nullable().optional().transform(val => val === "" ? null : val)
});