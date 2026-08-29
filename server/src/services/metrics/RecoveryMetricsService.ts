import { RECOVERY_ACTION_TYPES, type RecoveryActionType } from "../../domain/types.js";
import { RecoveryCase } from "../../models/RecoveryCase.js";

interface ActionMetric { casesExecuted: number; casesRecoveredAfterAction: number; recoveredRevenueObservedMinor: number; averageTimeToRecoveryHours: number | null; }
export interface RecoveryMetrics {
  totalCases: number; totalRevenueAtRiskMinor: number; recoveredCases: number; observedRecoveredRevenueMinor: number; unresolvedRevenueMinor: number;
  caseRecoveryRate: number; revenueRecoveryRate: number; averageTimeToRecoveryHours: number | null; recoveredWithin7DaysCount: number;
  actionBreakdown: Record<RecoveryActionType, ActionMetric>; recoveredWithoutExecutedAction: number; recoveredRevenueWithoutExecutedActionMinor: number;
  associationBreakdown: Record<string, number>; associationConfidenceBreakdown: Record<string, number>;
}
function average(values: number[]): number | null { return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : null; }

export async function getRecoveryMetrics(): Promise<RecoveryMetrics> {
  const cases = await RecoveryCase.find().lean();
  const actionBreakdown = Object.fromEntries(RECOVERY_ACTION_TYPES.map((action) => [action, { casesExecuted: 0, casesRecoveredAfterAction: 0, recoveredRevenueObservedMinor: 0, averageTimeToRecoveryHours: null }])) as Record<RecoveryActionType, ActionMetric>;
  const actionTimes = Object.fromEntries(RECOVERY_ACTION_TYPES.map((action) => [action, [] as number[]])) as Record<RecoveryActionType, number[]>;
  const associationBreakdown = { POST_ACTION_ASSOCIATION: 0, CARD_UPDATE_SEQUENCE: 0, NO_ACTION_ASSOCIATION: 0, UNATTRIBUTED: 0 };
  const associationConfidenceBreakdown = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
  let totalRevenueAtRiskMinor = 0, observedRecoveredRevenueMinor = 0, recoveredCases = 0, recoveredWithin7DaysCount = 0, recoveredWithoutExecutedAction = 0, recoveredRevenueWithoutExecutedActionMinor = 0;
  const allTimes: number[] = [];
  for (const item of cases) {
    totalRevenueAtRiskMinor += item.revenueAtRiskMinor;
    const executedTypes = new Set(item.actions.filter((action) => action.status === "EXECUTED").map((action) => action.type as RecoveryActionType));
    for (const action of executedTypes) actionBreakdown[action].casesExecuted += 1;
    if (item.outcome?.status !== "RECOVERED") continue;
    recoveredCases += 1; const amount = item.outcome.recoveredAmountMinor ?? item.recoveredAmountMinor ?? 0; observedRecoveredRevenueMinor += amount;
    if (item.outcome.recoveredWithin7Days === true) recoveredWithin7DaysCount += 1;
    if (typeof item.outcome.timeToRecoveryHours === "number") allTimes.push(item.outcome.timeToRecoveryHours);
    const association = item.outcome.actionAssociation; if (association && association in associationBreakdown) associationBreakdown[association as keyof typeof associationBreakdown] += 1;
    const confidence = item.outcome.actionAssociationConfidence; if (confidence && confidence in associationConfidenceBreakdown) associationConfidenceBreakdown[confidence as keyof typeof associationConfidenceBreakdown] += 1;
    const action = item.outcome.actionAtRecovery as RecoveryActionType | null;
    if (action && RECOVERY_ACTION_TYPES.includes(action)) { actionBreakdown[action].casesRecoveredAfterAction += 1; actionBreakdown[action].recoveredRevenueObservedMinor += amount; if (typeof item.outcome.timeToRecoveryHours === "number") actionTimes[action].push(item.outcome.timeToRecoveryHours); }
    else { recoveredWithoutExecutedAction += 1; recoveredRevenueWithoutExecutedActionMinor += amount; }
  }
  for (const action of RECOVERY_ACTION_TYPES) actionBreakdown[action].averageTimeToRecoveryHours = average(actionTimes[action]);
  const totalCases = cases.length; const unresolvedRevenueMinor = Math.max(totalRevenueAtRiskMinor - observedRecoveredRevenueMinor, 0);
  return { totalCases, totalRevenueAtRiskMinor, recoveredCases, observedRecoveredRevenueMinor, unresolvedRevenueMinor, caseRecoveryRate: totalCases ? recoveredCases / totalCases : 0, revenueRecoveryRate: totalRevenueAtRiskMinor ? observedRecoveredRevenueMinor / totalRevenueAtRiskMinor : 0, averageTimeToRecoveryHours: average(allTimes), recoveredWithin7DaysCount, actionBreakdown, recoveredWithoutExecutedAction, recoveredRevenueWithoutExecutedActionMinor, associationBreakdown, associationConfidenceBreakdown };
}
