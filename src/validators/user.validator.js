import { z } from "zod";

export const fcmTokenSchema = z.object({
  token: z.string().min(10, "Invalid FCM token format")
});