export const progressConfig = {
  decayHalfLifeDays: 30,
  maxCountedPerProjectPerDay: 5,
} as const;

export const matchingConfig = {
  weights: { skillFit: 0.5, progress: 0.25, userProgress: 0.15, availability: 0.1 },
  baselineProgress: 0.5,
  baselineDays: 14,
  needsFirstCollaboratorDays: 7,
} as const;
