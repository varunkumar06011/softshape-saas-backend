export const PLAN_CONFIG = {
  STARTER: { price: 7999, cashiers: 1, captains: 3 },
  PRO:     { price: 10000, cashiers: 3, captains: 5 },
  ENTERPRISE: { price: 12000, cashiers: 5, captains: 7 },
} as const;

export type PlanId = keyof typeof PLAN_CONFIG;

export function getPlanConfig(planId: string) {
  const key = planId.toUpperCase() as PlanId;
  if (!PLAN_CONFIG[key]) throw new Error(`Unknown plan: ${planId}`);
  return { ...PLAN_CONFIG[key], id: key };
}
