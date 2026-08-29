import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RecoveryContext } from "../src/domain/recovery/RecoveryContext.js";
import { HeuristicRecoveryScorer } from "../src/services/scorer/HeuristicRecoveryScorer.js";
import { LogisticRecoveryScorer } from "../src/services/scorer/LogisticRecoveryScorer.js";
import { createRecoveryScorer } from "../src/services/scorer/RecoveryScorerFactory.js";

interface ParityFile { tolerance: number; fixtures: Array<{ name: string; context: RecoveryContext; expectedProbabilities: Record<string, number> }> }

const modelPath = resolve("src/services/scorer/models/logistic_recovery_v1.json");
const parity = JSON.parse(readFileSync(resolve("src/services/scorer/models/parity_v1.json"), "utf8")) as ParityFile;

describe("LogisticRecoveryScorer", () => {
  it("loads the portable artifact and scores all four actions deterministically", () => {
    const scorer = new LogisticRecoveryScorer(modelPath);
    const context = parity.fixtures[0]!.context;
    const first = scorer.score(context);
    expect(first).toHaveLength(4);
    expect(first.map((score) => score.action)).toEqual(["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"]);
    expect(first.every((score) => score.probability > 0 && score.probability < 1)).toBe(true);
    expect(first.every((score) => score.expectedRecoveredMinor === Math.round(score.probability * context.caseState.revenueAtRiskMinor))).toBe(true);
    expect(first.every((score) => score.scorerVersion === "logistic-v1" && score.datasetVersion === "synthetic-recovery-v1")).toBe(true);
    expect(first[0]?.explanation).toContain("trained on synthetic-recovery-v1");
    expect(scorer.score(context)).toEqual(first);
  });

  it.each(parity.fixtures)("matches Python inference for $name", ({ context, expectedProbabilities }) => {
    const scores = new LogisticRecoveryScorer(modelPath).score(context);
    for (const score of scores) expect(Math.abs(score.probability - expectedProbabilities[score.action]!)).toBeLessThanOrEqual(parity.tolerance);
  });

  it("maps unsupported non-action categories to artifact fallbacks", () => {
    const original = parity.fixtures[0]!.context;
    const context: RecoveryContext = { ...original, subscription: { ...original.subscription, status: "paused" }, failure: { ...original.failure, paymentMethod: "wallet" }, downtime: { ...original.downtime, severity: null } };
    expect(new LogisticRecoveryScorer(modelPath).score(context)).toHaveLength(4);
  });

  it("fails clearly when the configured artifact is missing", () => {
    expect(() => new LogisticRecoveryScorer(resolve("src/services/scorer/models/missing.json"))).toThrow(/could not be loaded/);
  });

  it("selects heuristic and logistic implementations without silent fallback", () => {
    expect(createRecoveryScorer("heuristic")).toBeInstanceOf(HeuristicRecoveryScorer);
    expect(createRecoveryScorer("logistic", modelPath)).toBeInstanceOf(LogisticRecoveryScorer);
    expect(() => createRecoveryScorer("logistic", "missing-artifact.json")).toThrow();
  });
});
