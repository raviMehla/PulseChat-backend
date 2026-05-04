import { z } from "zod";

import { z } from "zod";

// ==========================================
// PROFILE & SETTINGS VALIDATORS
// ==========================================
export const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  bio: z.string().max(150, "Bio cannot exceed 150 characters").optional(),
  
  // 🛡️ ARCHITECTURAL UPGRADE: Safely parse stringified JSON from FormData
  settings: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch (e) {
          return val; // If it fails to parse, pass the raw string so Zod can throw a proper type error
        }
      }
      return val;
    },
    z.object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      notificationsEnabled: z.boolean().optional(),
    })
  ).optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(6, "Password is required to confirm deletion"),
  otp: z.string().length(6, "OTP must be exactly 6 digits")
});

// ==========================================
// SECURITY & PRIVACY VALIDATORS
// ==========================================
export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(6, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export const updatePrivacySchema = z.object({
  lastSeen: z.enum(["everyone", "nobody", "contacts"]).optional(),
  profilePhoto: z.enum(["everyone", "nobody", "contacts"]).optional(),
});

// ==========================================
// DISCOVERY / SEARCH VALIDATORS
// ==========================================
export const searchUserSchema = z.object({
  search: z.string()
    .min(1, "Search keyword is required")
    .max(50, "Search query is too long to process"),
});

// ==========================================
// DEVICE & NOTIFICATION VALIDATORS
// ==========================================
export const deviceTokenSchema = z.object({
  token: z.string().min(1, "Device token is required"),
});

export const fcmTokenSchema = z.object({
  token: z.string().min(1, "FCM Token is required"),
});