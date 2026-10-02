import { z } from "zod";

export const signupInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});
export type SignupInput = z.infer<typeof signupInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const skillTagSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[\w+.# -]+$/, "skill tags may only contain letters, digits, spaces, and _+.#-");

export const profileInputSchema = z.object({
  skills: z.array(skillTagSchema).min(1).max(20),
  interests: z.array(z.string().min(1).max(100)).max(20).default([]),
  availability: z
    .array(z.enum(["weekday-morning", "weekday-afternoon", "weekday-evening", "weekend-morning", "weekend-afternoon", "weekend-evening"]))
    .max(6)
    .default([]),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.string()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
