import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

// 🛡️ ARCHITECTURAL UPGRADE: 1-on-1 Chat Validation
export const accessChatSchema = z.object({
  userId: z.string().regex(objectIdRegex, "Invalid User ID format")
});

export const createGroupSchema = z.object({
  name: z.string()
    .min(1, "Group name cannot be empty")
    .max(50, "Group name is too long"),
  users: z.array(z.string().regex(objectIdRegex, "Invalid User ID format"))
    .min(1, "You must select at least 1 user to start a group"),
  description: z.string().max(250, "Description cannot exceed 250 characters").optional(),
  encryptedGroupKeys: z.array(z.object({
    userId: z.string().regex(objectIdRegex, "Invalid User ID format"),
    encryptedKey: z.string(),
    iv: z.string(),
    keyVersion: z.number().optional()
  })).optional()
});

export const searchUserSchema = z.object({
  search: z.string().max(50, "Search query is too long").optional(),
  q: z.string().max(50, "Search query is too long").optional(),
}).refine(data => (data.search && data.search.trim().length > 0) || (data.q && data.q.trim().length > 0), {
  message: "Search query cannot be empty"
}).transform(data => ({
  search: (data.search || data.q).trim()
}));

export const renameGroupSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  newName: z.string().min(1, "Group name cannot be empty").max(50, "Group name is too long")
});

export const groupMembershipSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  userId: z.string().regex(objectIdRegex, "Invalid User ID format"),
  encryptedKey: z.string().optional(),
  iv: z.string().optional(),
  keyVersion: z.number().optional()
});

export const leaveGroupSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format")
});

// 🛡️ ARCHITECTURAL UPGRADE: New details validator
export const updateGroupDetailsSchema = z.object({
  chatName: z.string().min(1, "Group name cannot be empty").max(50, "Group name is too long").optional(),
  description: z.string().max(250, "Description cannot exceed 250 characters").optional(),
});

export const deleteChatSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format")
});