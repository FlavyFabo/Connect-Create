import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { milestones, notes, projects, projectSkills, skills } from "../db/schema";

export type GuideContext = {
  title: string;
  description: string;
  category: string;
  skillsNeeded: string[];
  milestones: { title: string; state: string }[];
  notes: string[];
  idleDays: number;
};

export type GuideSuggestion = {
  title: string;
  detail: string;
  estimateMinutes: number;
};

export interface GuideProvider {
  plan(ctx: GuideContext): Promise<GuideSuggestion[]>;
  nudge(ctx: GuideContext): Promise<GuideSuggestion>;
}

export async function buildGuideContext(db: Db, projectId: string): Promise<GuideContext | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const skillRows = await db
    .select({ name: skills.name })
    .from(projectSkills)
    .innerJoin(skills, eq(projectSkills.skillId, skills.id))
    .where(eq(projectSkills.projectId, projectId));
  const ms = await db
    .select({ title: milestones.title, state: milestones.state })
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(asc(milestones.position), asc(milestones.createdAt));
  const ns = await db
    .select({ body: notes.body })
    .from(notes)
    .where(eq(notes.projectId, projectId))
    .orderBy(asc(notes.createdAt));

  return {
    title: project.title,
    description: project.description,
    category: project.category,
    skillsNeeded: skillRows.map((r) => r.name),
    milestones: ms,
    notes: ns.map((n) => n.body),
    idleDays: Math.max(0, (Date.now() - project.lastActivityAt.getTime()) / 86_400_000),
  };
}

export class RuleBasedGuide implements GuideProvider {
  async plan(ctx: GuideContext): Promise<GuideSuggestion[]> {
    const firstSkill = ctx.skillsNeeded[0] ?? "the required";
    const ideas: GuideSuggestion[] = [
      {
        title: `Define the smallest demoable version of "${ctx.title}"`,
        detail: `Write down the single outcome that would prove "${ctx.title}" works: ${ctx.description.slice(0, 120)}`,
        estimateMinutes: 25,
      },
      {
        title: "Outline the project on one page",
        detail: `One paragraph each on goal, audience, and first three steps for this ${ctx.category} project.`,
        estimateMinutes: 30,
      },
      {
        title: `Set up the ${firstSkill} toolchain`,
        detail: `Install what's needed for ${firstSkill} and get a trivial hello-world running.`,
        estimateMinutes: 30,
      },
      {
        title: "Build the first end-to-end slice",
        detail: `The thinnest working version of the core idea — ugly is fine.`,
        estimateMinutes: 30,
      },
      {
        title: "Share the demo for feedback",
        detail: "Post evidence on the workbench and ask one person for a reaction.",
        estimateMinutes: 20,
      },
      {
        title: "Write the first workbench note",
        detail: "Log where the project stands and what's blocking it.",
        estimateMinutes: 10,
      },
      {
        title: "List the unknowns",
        detail: `Three questions whose answers would de-risk "${ctx.title}" the most.`,
        estimateMinutes: 15,
      },
    ];
    const existing = new Set(ctx.milestones.map((m) => m.title));
    const fresh = ideas.filter((i) => !existing.has(i.title));
    return fresh.slice(0, 7);
  }

  async nudge(ctx: GuideContext): Promise<GuideSuggestion> {
    const open = ctx.milestones.find((m) => m.state === "todo");
    if (open) {
      return {
        title: `Advance "${open.title}" by one small step`,
        detail: `Spend 25 minutes on the smallest piece of "${open.title}" — stop when the timer ends.`,
        estimateMinutes: 25,
      };
    }
    return {
      title: `Write the next action for "${ctx.title}"`,
      detail: ctx.idleDays >= 5
        ? `It's been ${Math.floor(ctx.idleDays)} days — write one sentence naming the next concrete step, then do the first 20 minutes of it.`
        : `Write one sentence naming the next concrete step for "${ctx.title}".`,
      estimateMinutes: 20,
    };
  }
}
