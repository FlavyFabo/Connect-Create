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

export const projectStatusSchema = z.enum(["open", "in_progress", "paused", "done"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const createProjectInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.string().min(1).max(100),
  skillsNeeded: z.array(skillTagSchema).min(1).max(10),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const listProjectsQuerySchema = z.object({
  skills: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  sort: z.enum(["match", "recent"]).optional(),
  cursor: z.string().max(100).optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const evidenceInputSchema = z.object({
  type: z.enum(["text", "url", "file"]),
  content: z.string().min(1).max(5000),
});
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export const createMilestoneInputSchema = z.object({
  title: z.string().min(1).max(200),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

export const updateMilestoneInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  state: z.enum(["todo", "done"]).optional(),
  evidence: evidenceInputSchema.nullable().optional(),
});
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;

export const createNoteInputSchema = z.object({
  body: z.string().min(1).max(2000),
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const createRequestInputSchema = z.object({
  message: z.string().min(1).max(500),
  userId: z.string().uuid().optional(),
});
export type CreateRequestInput = z.infer<typeof createRequestInputSchema>;

export const createMessageInputSchema = z.object({
  body: z.string().min(1).max(2000),
});
export type CreateMessageInput = z.infer<typeof createMessageInputSchema>;

export const reportInputSchema = z.object({
  targetType: z.enum(["project", "user", "message"]),
  targetId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.string()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
