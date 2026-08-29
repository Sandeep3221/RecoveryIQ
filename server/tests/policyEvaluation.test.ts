import { resolve } from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { aggregateStrategy, safeRate, simulatedComparison } from "../src/evaluation/evaluationMetrics.js";
import { persistPolicyEvaluation, realizeEpisode, runPolicyEvaluation, type EvaluationEpisode } from "../src/evaluation/PolicyEvaluationRunner.js";
import { EvaluationRun } from "../src/models/EvaluationRun.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";

const datasetPath = resolve(process.cwd(), "../ml/data/synthetic_policy_eval_v1.jsonl");
let memoryMongo: MongoMemoryServer;
let cached: Awaited<ReturnType<typeof runPolicyEvaluation>>;

beforeAll(async () => { memoryMongo = await MongoMemoryServer.create(); await mongoose.connect(memoryMongo.getUri()); cached = await runPolicyEvaluation({ datasetPath, writeReports: false }); }, 120_000);
beforeEach(async () => { await EvaluationRun.deleteMany({}); });
afterAll(async () => { await mongoose.disconnect(); await memoryMongo.stop(); });

describe("controlled policy evaluation", () => {
  it("runs fresh contexts through production scorers and policy without RecoveryCase mutation", async () => {
    expect(cached.report).toMatchObject({ datasetVersion: "synthetic-policy-eval-v1", seed: 4242, episodeCount: 10_000, productionInvocations: { logisticScorer: 10_000, heuristicScorer: 10_000, policyEngine: 20_000 } });
    expect(cached.report.datasetHash).toHaveLength(64); expect(await RecoveryCase.countDocuments()).toBe(0);
  });
  it("is reproducible for the same seed artifact", async () => { const rerun = await runPolicyEvaluation({ datasetPath, writeReports: false }); expect(rerun.report).toEqual(cached.report); expect(rerun.reportHash).toBe(cached.reportHash); }, 120_000);
  it("keeps ground truth outside RecoveryContext and uses one shared draw", () => {
    const context = { caseId: "boundary", subscription: { id: "sub", status: "pending", amountMinor: 10000, ageDays: 3, nativeRetryPossible: true }, failure: { category: "BANK_OR_NETWORK", reason: null, source: null, step: null, paymentMethod: "card", failureCount: 1, consecutiveFailureCount: 1 }, customerHistory: { previousSuccessfulPayments: 0, previousFailedPayments: 0, previousRecoveredPayments: 0, previousRecoveryRate: 0, previousNudges: 0, hoursSinceLastNudge: null }, diagnosis: { classifierVersion: "classifier-v1", confidence: "HIGH", explanation: "fixture" }, downtime: { checked: true, active: false, method: null, severity: null, matchLevel: "NONE" }, caseState: { caseAgeHours: 1, revenueAtRiskMinor: 10000, previousActions: [] } } as const;
    expect("groundTruth" in context).toBe(false);
    const episode = { contextId: "boundary", context, groundTruth: { WAIT_NATIVE_RETRY: 0.6, SEND_NUDGE: 0.4, REQUEST_CARD_UPDATE: 0.2, STOP_AND_ESCALATE: 0.1 }, randomDraw: 0.5 } as EvaluationEpisode;
    expect(realizeEpisode(episode, "WAIT_NATIVE_RETRY").recovered).toBe(true); expect(realizeEpisode(episode, "SEND_NUDGE").recovered).toBe(false);
  });
  it("calculates strategy, disagreement, and policy safety metrics", () => {
    const logistic = cached.report.strategies.RECOVERYIQ_LOGISTIC_POLICY;
    expect(logistic.totalCustomerInterventions).toBe(logistic.nudgesSelected + logistic.cardUpdatesSelected);
    expect(cached.report.policySafety.hardRuleDecisionCount + cached.report.policySafety.modelRankedDecisionCount).toBe(10_000);
    expect(Object.values(cached.report.policySafety.reasonBreakdown).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(cached.report.logisticVsHeuristic.actionSelectionDisagreementRate).toBeGreaterThanOrEqual(0);
  });
  it("handles zero denominators", () => { const empty = aggregateStrategy([]); expect(safeRate(1, 0)).toBe(0); expect(empty.expectedRevenueRecoveryRate).toBe(0); expect(simulatedComparison(empty, empty).simulatedExpectedRevenueUpliftRate).toBeNull(); });
});

describe("EvaluationRun API", () => {
  it("returns empty state", async () => { expect((await request(app).get("/api/v1/evaluation/latest")).body).toEqual({ evaluation: null }); });
  it("persists one summary idempotently", async () => { await persistPolicyEvaluation(cached.report, cached.reportHash); await persistPolicyEvaluation(cached.report, cached.reportHash); expect(await EvaluationRun.countDocuments()).toBe(1); const response = await request(app).get("/api/v1/evaluation/latest"); expect(response.body.evaluation).toMatchObject({ evaluationVersion: "policy-eval-v1", episodeCount: 10_000, datasetHash: cached.report.datasetHash }); expect(response.body.evaluation).not.toHaveProperty("contexts"); });
});
