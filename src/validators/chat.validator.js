import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createGroupSchema = z.object({
  name: z.string()
    .min(1, "Group name cannot be empty")
    .max(50, "Group name is too long"),
  users: z.array(z.string().regex(objectIdRegex, "Invalid User ID format"))
    .min(1, "You must select at least 1 user to start a group") 
});

export const searchUserSchema = z.object({
  search: z.string()
    .min(1, "Search query cannot be empty")
    .max(50, "Search query is too long")
});

export const renameGroupSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  newName: z.string().min(1, "Group name cannot be empty").max(50, "Group name is too long")
});

export const groupMembershipSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format"),
  userId: z.string().regex(objectIdRegex, "Invalid User ID format")
});

export const leaveGroupSchema = z.object({
  chatId: z.string().regex(objectIdRegex, "Invalid Chat ID format")
});

// 🛡️ ARCHITECTURAL UPGRADE: New details validator
export const updateGroupDetailsSchema = z.object({
  chatName: z.string().min(1, "Group name cannot be empty").max(50, "Group name is too long").optional(),
  description: z.string().max(250, "Description cannot exceed 250 characters").optional(),
});