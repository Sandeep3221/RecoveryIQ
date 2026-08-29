import { RECOVERY_ACTION_TYPES, type FailureCategory, type RecoveryActionType } from "../domain/types.js";

export interface EpisodeResult {
  amountMinor: number;
  category: FailureCategory;
  subscriptionStatus: string;
  selectedAction: RecoveryActionType;
  trueProbability: number;
  recovered: boolean;
}

export interface GroupMetrics {
  caseCount: number;
  expectedRecoveryRate: number;
  realizedRecoveryRate: number;
  dominantSelectedAction: RecoveryActionType | null;
}

export interface StrategyMetrics {
  episodes: number;
  totalRevenueAtRiskMinor: number;
  expectedRecoveredRevenueMinor: number;
  realizedRecoveredRevenueMinor: number;
  expectedRevenueRecoveryRate: number;
  realizedRevenueRecoveryRate: number;
  expectedRecoveredCases: number;
  realizedRecoveredCases: number;
  realizedCaseRecoveryRate: number;
  actionDistribution: Record<RecoveryActionType, number>;
  nudgesSelected: number;
  cardUpdatesSelected: number;
  totalCustomerInterventions: number;
  customerInterventionsPer100Cases: number;
  perCategory: Record<string, GroupMetrics>;
  perStatus: Record<string, GroupMetrics>;
}

export function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function actionCounts(rows: EpisodeResult[]): Record<RecoveryActionType, number> {
  return Object.fromEntries(RECOVERY_ACTION_TYPES.map((action) => [action, rows.filter((row) => row.selectedAction === action).length])) as Record<RecoveryActionType, number>;
}

function group(rows: EpisodeResult[], key: (row: EpisodeResult) => string): Record<string, GroupMetrics> {
  const buckets = new Map<string, EpisodeResult[]>();
  for (const row of rows) buckets.set(key(row), [...(buckets.get(key(row)) ?? []), row]);
  return Object.fromEntries([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => {
    const counts = actionCounts(items);
    const dominant = [...RECOVERY_ACTION_TYPES].sort((a, b) => counts[b] - counts[a] || RECOVERY_ACTION_TYPES.indexOf(a) - RECOVERY_ACTION_TYPES.indexOf(b))[0] ?? null;
    return [name, {
      caseCount: items.length,
      expectedRecoveryRate: safeRate(items.reduce((sum, item) => sum + item.trueProbability, 0), items.length),
      realizedRecoveryRate: safeRate(items.filter((item) => item.recovered).length, items.length),
      dominantSelectedAction: dominant,
    }];
  }));
}

export function aggregateStrategy(rows: EpisodeResult[]): StrategyMetrics {
  const actionDistribution = actionCounts(rows);
  const totalRevenueAtRiskMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const expectedRevenue = rows.reduce((sum, row) => sum + row.amountMinor * row.trueProbability, 0);
  const realizedRevenue = rows.reduce((sum, row) => sum + (row.recovered ? row.amountMinor : 0), 0);
  const expectedRecoveredCases = rows.reduce((sum, row) => sum + row.trueProbability, 0);
  const realizedRecoveredCases = rows.filter((row) => row.recovered).length;
  const totalCustomerInterventions = actionDistribution.SEND_NUDGE + actionDistribution.REQUEST_CARD_UPDATE;
  return {
    episodes: rows.length,
    totalRevenueAtRiskMinor,
    expectedRecoveredRevenueMinor: Math.round(expectedRevenue),
    realizedRecoveredRevenueMinor: realizedRevenue,
    expectedRevenueRecoveryRate: safeRate(expectedRevenue, totalRevenueAtRiskMinor),
    realizedRevenueRecoveryRate: safeRate(realizedRevenue, totalRevenueAtRiskMinor),
    expectedRecoveredCases,
    realizedRecoveredCases,
    realizedCaseRecoveryRate: safeRate(realizedRecoveredCases, rows.length),
    actionDistribution,
    nudgesSelected: actionDistribution.SEND_NUDGE,
    cardUpdatesSelected: actionDistribution.REQUEST_CARD_UPDATE,
    totalCustomerInterventions,
    customerInterventionsPer100Cases: safeRate(totalCustomerInterventions * 100, rows.length),
    perCategory: group(rows, (row) => row.category),
    perStatus: group(rows, (row) => row.subscriptionStatus),
  };
}

export function simulatedComparison(recoveryIQ: StrategyMetrics, baseline: StrategyMetrics) {
  const expectedDelta = recoveryIQ.expectedRecoveredRevenueMinor - baseline.expectedRecoveredRevenueMinor;
  const realizedDelta = recoveryIQ.realizedRecoveredRevenueMinor - baseline.realizedRecoveredRevenueMinor;
  return {
    simulatedExpectedRevenueDeltaMinor: expectedDelta,
    simulatedExpectedRevenueUpliftRate: baseline.expectedRecoveredRevenueMinor === 0 ? null : expectedDelta / baseline.expectedRecoveredRevenueMinor,
    simulatedRealizedRevenueDeltaMinor: realizedDelta,
    simulatedRealizedRevenueUpliftRate: baseline.realizedRecoveredRevenueMinor === 0 ? null : realizedDelta / baseline.realizedRecoveredRevenueMinor,
  };
}
