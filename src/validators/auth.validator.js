import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().min(1, "Identifier required"),
  password: z.string().min(6, "Password must be at least 6 characters")
});

export const registerSchema = z.object({
  name: z.string().min(2),
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6)
});