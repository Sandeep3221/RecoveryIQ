import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { recoveryPolicy } from "../config/recoveryPolicy.js";
import type { RecoveryContext } from "../domain/recovery/RecoveryContext.js";
import { RECOVERY_ACTION_TYPES, type RecoveryActionType } from "../domain/types.js";
import { EvaluationRun } from "../models/EvaluationRun.js";
import { evaluateRecoveryPolicy } from "../services/policy/RecoveryPolicyEngine.js";
import { HeuristicRecoveryScorer } from "../services/scorer/HeuristicRecoveryScorer.js";
import { LogisticRecoveryScorer } from "../services/scorer/LogisticRecoveryScorer.js";
import type { RecoveryScore, RecoveryScorer } from "../services/scorer/RecoveryScorer.js";
import { naiveNudgeFirst, naiveRetryFirst } from "./baselines.js";
import { aggregateStrategy, simulatedComparison, type EpisodeResult, type StrategyMetrics } from "./evaluationMetrics.js";

export const STRATEGIES = ["RECOVERYIQ_LOGISTIC_POLICY", "HEURISTIC_POLICY", "NAIVE_RETRY_FIRST", "NAIVE_NUDGE_FIRST"] as const;
export type StrategyName = typeof STRATEGIES[number];

export interface EvaluationEpisode {
  contextId: string;
  context: RecoveryContext;
  groundTruth: Record<RecoveryActionType, number>;
  randomDraw: number;
}

export interface PolicyEvaluationReport {
  evaluationVersion: "policy-eval-v1";
  datasetVersion: "synthetic-policy-eval-v1";
  modelVersion: "logistic-v1";
  policyVersion: "policy-v1";
  seed: 4242;
  episodeCount: number;
  datasetHash: string;
  generatedAt: string;
  disclaimer: string;
  strategies: Record<StrategyName, StrategyMetrics>;
  comparisons: Record<string, ReturnType<typeof simulatedComparison>>;
  logisticVsHeuristic: {
    expectedRevenueDifferenceMinor: number;
    realizedRevenueDifferenceMinor: number;
    expectedRecoveryRateDifference: number;
    realizedRecoveryRateDifference: number;
    customerInterventionDifference: number;
    actionSelectionDisagreementRate: number;
  };
  policySafety: {
    hardRuleDecisionCount: number;
    modelRankedDecisionCount: number;
    hardRuleDecisionRate: number;
    modelRankedDecisionRate: number;
    rawModelWinnerBlockedCount: number;
    rawModelWinnerBlockedRate: number;
    reasonBreakdown: Record<string, number>;
  };
  productionInvocations: { logisticScorer: number; heuristicScorer: number; policyEngine: number };
}

export interface RunnerOptions {
  datasetPath?: string;
  jsonReportPath?: string;
  markdownReportPath?: string;
  writeReports?: boolean;
  logisticScorer?: RecoveryScorer;
  heuristicScorer?: RecoveryScorer;
}

const fixedDecisionTime = new Date("2026-01-01T00:00:00.000Z");

function rankedWinner(scores: RecoveryScore[]): RecoveryActionType {
  return [...scores].sort((a, b) => b.probability - a.probability || RECOVERY_ACTION_TYPES.indexOf(a.action) - RECOVERY_ACTION_TYPES.indexOf(b.action))[0]!.action;
}

export function realizeEpisode(episode: EvaluationEpisode, selectedAction: RecoveryActionType): EpisodeResult {
  const trueProbability = episode.groundTruth[selectedAction];
  if (!Number.isFinite(trueProbability) || trueProbability < 0 || trueProbability > 1) throw new Error(`Invalid evaluation ground truth for ${episode.contextId}/${selectedAction}.`);
  return {
    amountMinor: episode.context.caseState.revenueAtRiskMinor,
    category: episode.context.failure.category,
    subscriptionStatus: episode.context.subscription.status,
    selectedAction,
    trueProbability,
    recovered: episode.randomDraw < trueProbability,
  };
}

function reportMarkdown(report: PolicyEvaluationReport): string {
  const money = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
  const names: Record<StrategyName, string> = {
    RECOVERYIQ_LOGISTIC_POLICY: "RecoveryIQ Logistic + Policy",
    HEURISTIC_POLICY: "Heuristic + Policy",
    NAIVE_RETRY_FIRST: "Retry First",
    NAIVE_NUDGE_FIRST: "Nudge First",
  };
  const rows = STRATEGIES.map((name) => {
    const metric = report.strategies[name];
    return `| ${names[name]} | ${money(metric.expectedRecoveredRevenueMinor)} | ${money(metric.realizedRecoveredRevenueMinor)} | ${pct(metric.expectedRevenueRecoveryRate)} | ${pct(metric.realizedRevenueRecoveryRate)} | ${metric.totalCustomerInterventions.toLocaleString("en-IN")} |`;
  }).join("\n");
  const logistic = report.strategies.RECOVERYIQ_LOGISTIC_POLICY;
  return `# Synthetic Policy Evaluation v1\n\n> **SYNTHETIC / SIMULATED / CONTROLLED EVALUATION.** ${report.disclaimer}\n\n## Evaluation Setup\n\n- Dataset: ${report.datasetVersion}\n- Seed: ${report.seed}\n- Fresh contexts: ${report.episodeCount.toLocaleString("en-IN")}\n- Dataset SHA-256: \`${report.datasetHash}\`\n- Frozen model: ${report.modelVersion}\n- Deterministic policy: ${report.policyVersion}\n\nThe evaluation rows are one recovery context each. Hidden per-action probabilities and a shared random draw are evaluation-only and are applied only after the production scorer and policy choose an action. Amounts are sampled from ₹299, ₹499, ₹699, ₹999, ₹1,499, and ₹2,499 plans.\n\n## Synthetic Data Disclaimer\n\nAll Stage 9 revenue and uplift figures are generated inside synthetic-policy-eval-v1. They do not represent actual Razorpay merchant recovery performance. RecoveryIQ's real Razorpay integration validates data flow and operational behavior; Stage 9 validates policy behavior only inside a controlled simulation.\n\n## Strategies\n\nRecoveryIQ uses the production LogisticRecoveryScorer and policy-v1. Heuristic Policy swaps in heuristic-v1 while holding policy-v1 fixed. Retry First waits only when pending native retry is feasible. Nudge First contacts the customer when merchant-policy contact guards allow. STOP_AND_ESCALATE's probability represents later external/manual resolution; STOP does not itself collect payment.\n\n## Overall Results\n\n| Strategy | Simulated expected recovered | Simulated realized recovered | Expected rate | Realized rate | Customer interventions |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\n## Simulated Revenue Comparison\n\n${Object.entries(report.comparisons).map(([name, value]) => `- Versus ${name}: simulated expected delta ${money(value.simulatedExpectedRevenueDeltaMinor)} (${value.simulatedExpectedRevenueUpliftRate === null ? "n/a" : pct(value.simulatedExpectedRevenueUpliftRate)}); simulated realized delta ${money(value.simulatedRealizedRevenueDeltaMinor)}.`).join("\n")}\n\n## Action Distribution\n\n${STRATEGIES.map((name) => `- ${names[name]}: ${RECOVERY_ACTION_TYPES.map((action) => `${action} ${report.strategies[name].actionDistribution[action]}`).join(", ")}.`).join("\n")}\n\n## Customer Intervention Comparison\n\nRecoveryIQ selected ${logistic.nudgesSelected} nudges and ${logistic.cardUpdatesSelected} card updates: ${logistic.customerInterventionsPer100Cases.toFixed(2)} simulated interventions per 100 cases. No real customer was contacted.\n\n## Logistic vs Heuristic\n\n- Simulated expected recovered-revenue difference: ${money(report.logisticVsHeuristic.expectedRevenueDifferenceMinor)}\n- Simulated realized recovered-revenue difference: ${money(report.logisticVsHeuristic.realizedRevenueDifferenceMinor)}\n- Action-selection disagreement: ${pct(report.logisticVsHeuristic.actionSelectionDisagreementRate)}\n- Customer-intervention difference: ${report.logisticVsHeuristic.customerInterventionDifference}\n\n## Policy Safety Analysis\n\n- Hard-rule decisions: ${report.policySafety.hardRuleDecisionCount} (${pct(report.policySafety.hardRuleDecisionRate)})\n- Model-ranked decisions: ${report.policySafety.modelRankedDecisionCount} (${pct(report.policySafety.modelRankedDecisionRate)})\n- Raw model winners blocked by policy: ${report.policySafety.rawModelWinnerBlockedCount} (${pct(report.policySafety.rawModelWinnerBlockedRate)})\n- Policy reasons: ${Object.entries(report.policySafety.reasonBreakdown).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${reason} ${count}`).join(", ")}\n\n## Per-Failure-Category Results\n\n${Object.entries(logistic.perCategory).map(([category, value]) => `- ${category}: n=${value.caseCount}, expected ${pct(value.expectedRecoveryRate)}, realized ${pct(value.realizedRecoveryRate)}, dominant action ${value.dominantSelectedAction}.`).join("\n")}\n\n## Limitations\n\nThis controlled simulator can compare policy behavior under published assumptions, but it cannot prove production merchant uplift, customer response, or causality. Hidden probabilities are synthetic ground truth, not observed Razorpay behavior.\n\n## Reproducibility\n\nRun \`python ml/policy_evaluation/generate_policy_eval.py\`, then \`npm run evaluation:policy\` in \`server\`. The model remains frozen; synthetic-policy-eval-v1 must never be used by train.py. Common random numbers ensure every strategy faces the same draw for each context.\n`;
}

export async function runPolicyEvaluation(options: RunnerOptions = {}): Promise<{ report: PolicyEvaluationReport; reportHash: string }> {
  const datasetPath = options.datasetPath ?? resolve(process.cwd(), "../ml/data/synthetic_policy_eval_v1.jsonl");
  const jsonPath = options.jsonReportPath ?? resolve(process.cwd(), "../ml/reports/policy_evaluation_v1.json");
  const markdownPath = options.markdownReportPath ?? resolve(process.cwd(), "../ml/reports/policy_evaluation_v1.md");
  const bytes = await readFile(datasetPath);
  const episodes = bytes.toString("utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EvaluationEpisode);
  const logisticScorer = options.logisticScorer ?? new LogisticRecoveryScorer();
  const heuristicScorer = options.heuristicScorer ?? new HeuristicRecoveryScorer();
  const outcomes = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, [] as EpisodeResult[]])) as Record<StrategyName, EpisodeResult[]>;
  let hardRuleDecisionCount = 0;
  let rawModelWinnerBlockedCount = 0;
  let disagreements = 0;
  const reasonBreakdown: Record<string, number> = {};
  const productionInvocations = { logisticScorer: 0, heuristicScorer: 0, policyEngine: 0 };

  for (const episode of episodes) {
    const context = episode.context;
    const logisticScores = logisticScorer.score(context); productionInvocations.logisticScorer += 1;
    const logisticDecision = evaluateRecoveryPolicy({ context, scores: logisticScores, policyConfig: recoveryPolicy, decidedAt: fixedDecisionTime }); productionInvocations.policyEngine += 1;
    const heuristicScores = heuristicScorer.score(context); productionInvocations.heuristicScorer += 1;
    const heuristicDecision = evaluateRecoveryPolicy({ context, scores: heuristicScores, policyConfig: recoveryPolicy, decidedAt: fixedDecisionTime }); productionInvocations.policyEngine += 1;
    if (logisticDecision.hardRuleApplied) hardRuleDecisionCount += 1;
    reasonBreakdown[logisticDecision.reasonCode] = (reasonBreakdown[logisticDecision.reasonCode] ?? 0) + 1;
    if (!logisticDecision.allowedActions.includes(rankedWinner(logisticScores))) rawModelWinnerBlockedCount += 1;
    if (logisticDecision.selectedAction !== heuristicDecision.selectedAction) disagreements += 1;
    outcomes.RECOVERYIQ_LOGISTIC_POLICY.push(realizeEpisode(episode, logisticDecision.selectedAction));
    outcomes.HEURISTIC_POLICY.push(realizeEpisode(episode, heuristicDecision.selectedAction));
    outcomes.NAIVE_RETRY_FIRST.push(realizeEpisode(episode, naiveRetryFirst(context)));
    outcomes.NAIVE_NUDGE_FIRST.push(realizeEpisode(episode, naiveNudgeFirst(context)));
  }

  const strategies = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, aggregateStrategy(outcomes[strategy])])) as Record<StrategyName, StrategyMetrics>;
  const recoveryIQ = strategies.RECOVERYIQ_LOGISTIC_POLICY;
  const heuristic = strategies.HEURISTIC_POLICY;
  const report: PolicyEvaluationReport = {
    evaluationVersion: "policy-eval-v1", datasetVersion: "synthetic-policy-eval-v1", modelVersion: "logistic-v1", policyVersion: "policy-v1", seed: 4242,
    episodeCount: episodes.length, datasetHash: createHash("sha256").update(bytes).digest("hex"), generatedAt: "2026-01-01T00:00:00.000Z",
    disclaimer: "All figures are synthetic simulation results and do not represent actual merchant uplift.", strategies,
    comparisons: {
      HEURISTIC_POLICY: simulatedComparison(recoveryIQ, heuristic),
      NAIVE_RETRY_FIRST: simulatedComparison(recoveryIQ, strategies.NAIVE_RETRY_FIRST),
      NAIVE_NUDGE_FIRST: simulatedComparison(recoveryIQ, strategies.NAIVE_NUDGE_FIRST),
    },
    logisticVsHeuristic: {
      expectedRevenueDifferenceMinor: recoveryIQ.expectedRecoveredRevenueMinor - heuristic.expectedRecoveredRevenueMinor,
      realizedRevenueDifferenceMinor: recoveryIQ.realizedRecoveredRevenueMinor - heuristic.realizedRecoveredRevenueMinor,
      expectedRecoveryRateDifference: recoveryIQ.expectedRevenueRecoveryRate - heuristic.expectedRevenueRecoveryRate,
      realizedRecoveryRateDifference: recoveryIQ.realizedRevenueRecoveryRate - heuristic.realizedRevenueRecoveryRate,
      customerInterventionDifference: recoveryIQ.totalCustomerInterventions - heuristic.totalCustomerInterventions,
      actionSelectionDisagreementRate: episodes.length === 0 ? 0 : disagreements / episodes.length,
    },
    policySafety: {
      hardRuleDecisionCount, modelRankedDecisionCount: episodes.length - hardRuleDecisionCount,
      hardRuleDecisionRate: episodes.length === 0 ? 0 : hardRuleDecisionCount / episodes.length,
      modelRankedDecisionRate: episodes.length === 0 ? 0 : (episodes.length - hardRuleDecisionCount) / episodes.length,
      rawModelWinnerBlockedCount, rawModelWinnerBlockedRate: episodes.length === 0 ? 0 : rawModelWinnerBlockedCount / episodes.length,
      reasonBreakdown,
    }, productionInvocations,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const reportHash = createHash("sha256").update(json).digest("hex");
  if (options.writeReports !== false) {
    await mkdir(dirname(jsonPath), { recursive: true });
    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(jsonPath, json, "utf8");
    await writeFile(markdownPath, reportMarkdown(report), "utf8");
  }
  return { report, reportHash };
}

export async function persistPolicyEvaluation(report: PolicyEvaluationReport, reportHash: string): Promise<void> {
  await EvaluationRun.findOneAndUpdate(
    { evaluationVersion: report.evaluationVersion, datasetHash: report.datasetHash },
    { $set: { ...report, reportHash, createdAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
