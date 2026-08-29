import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RECOVERY_ACTION_TYPES, type RecoveryActionType } from "../../domain/types.js";
import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import type { RecoveryScore, RecoveryScorer } from "./RecoveryScorer.js";

interface LogisticArtifact {
  modelVersion: string;
  datasetVersion: string;
  featureNames: string[];
  numericFeatures: string[];
  categoricalValues: Record<string, string[]>;
  categoricalDefaults: Record<string, string>;
  scaler: { means: number[]; scales: number[] };
  coefficients: number[];
  intercept: number;
}

const DEFAULT_ARTIFACT_PATH = resolve(__dirname, "models", "logistic_recovery_v1.json");

function loadArtifact(path = DEFAULT_ARTIFACT_PATH): LogisticArtifact {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`Logistic recovery model artifact could not be loaded from ${path}.`); }
  if (!parsed || typeof parsed !== "object") throw new Error("Logistic recovery model artifact is invalid.");
  const artifact = parsed as Partial<LogisticArtifact>;
  if (artifact.modelVersion !== "logistic-v1" || artifact.datasetVersion !== "synthetic-recovery-v1" || !Array.isArray(artifact.featureNames) || !Array.isArray(artifact.numericFeatures) || !Array.isArray(artifact.coefficients) || typeof artifact.intercept !== "number" || !artifact.scaler || !Array.isArray(artifact.scaler.means) || !Array.isArray(artifact.scaler.scales) || !artifact.categoricalValues || !artifact.categoricalDefaults) {
    throw new Error("Logistic recovery model artifact is invalid.");
  }
  if (artifact.featureNames.length !== artifact.coefficients.length || artifact.numericFeatures.length !== artifact.scaler.means.length || artifact.numericFeatures.length !== artifact.scaler.scales.length || artifact.scaler.scales.some((value) => !Number.isFinite(value) || value === 0)) {
    throw new Error("Logistic recovery model artifact dimensions are invalid.");
  }
  return artifact as LogisticArtifact;
}

function normalizedCategory(artifact: LogisticArtifact, column: string, value: string | null): string {
  const allowed = artifact.categoricalValues[column];
  if (!allowed) throw new Error(`Model artifact does not define ${column}.`);
  if (value && allowed.includes(value)) return value;
  const fallback = artifact.categoricalDefaults[column];
  if (!fallback || !allowed.includes(fallback)) throw new Error(`Model artifact has no safe fallback for ${column}.`);
  return fallback;
}

function numericValues(context: RecoveryContext): Record<string, number> {
  return {
    amountMinor: context.subscription.amountMinor,
    failureCount: context.failure.failureCount,
    consecutiveFailureCount: context.failure.consecutiveFailureCount,
    subscriptionAgeDays: context.subscription.ageDays,
    previousRecoveryRate: context.customerHistory.previousRecoveryRate,
    previousFailedPayments: context.customerHistory.previousFailedPayments,
    previousNudges: context.customerHistory.previousNudges,
    nativeRetryPossible: context.subscription.nativeRetryPossible ? 1 : 0,
    downtimeActive: context.downtime.active ? 1 : 0,
    caseAgeHours: context.caseState.caseAgeHours,
  };
}

export class LogisticRecoveryScorer implements RecoveryScorer {
  private readonly artifact: LogisticArtifact;

  constructor(artifactPath?: string) { this.artifact = loadArtifact(artifactPath); }

  private vector(context: RecoveryContext, action: RecoveryActionType): number[] {
    const index = new Map(this.artifact.featureNames.map((name, position) => [name, position]));
    const vector = new Array<number>(this.artifact.featureNames.length).fill(0);
    const numeric = numericValues(context);
    this.artifact.numericFeatures.forEach((name, position) => {
      const value = numeric[name];
      if (value === undefined || !Number.isFinite(value)) throw new Error(`RecoveryContext numeric feature ${name} is invalid.`);
      vector[index.get(name)!] = (value - this.artifact.scaler.means[position]!) / this.artifact.scaler.scales[position]!;
    });
    const categories: Record<string, string> = {
      failureCategory: normalizedCategory(this.artifact, "failureCategory", context.failure.category),
      paymentMethod: normalizedCategory(this.artifact, "paymentMethod", context.failure.paymentMethod),
      subscriptionStatus: normalizedCategory(this.artifact, "subscriptionStatus", context.subscription.status),
      diagnosisConfidence: normalizedCategory(this.artifact, "diagnosisConfidence", context.diagnosis.confidence),
      candidateAction: action,
      downtimeSeverity: normalizedCategory(this.artifact, "downtimeSeverity", context.downtime.severity ?? "none"),
    };
    for (const [column, value] of Object.entries(categories)) vector[index.get(`${column}=${value}`)!] = 1;
    vector[index.get(`failureCategory=${categories.failureCategory}|candidateAction=${action}`)!] = 1;
    if (context.subscription.nativeRetryPossible) vector[index.get(`candidateAction=${action}|nativeRetryPossible=1`)!] = 1;
    if (context.downtime.active) vector[index.get(`candidateAction=${action}|downtimeActive=1`)!] = 1;
    if (categories.subscriptionStatus === "halted") vector[index.get(`candidateAction=${action}|halted=1`)!] = 1;
    if (context.customerHistory.previousNudges >= 2) vector[index.get(`candidateAction=${action}|previousNudges>=2`)!] = 1;
    return vector;
  }

  private explanation(vector: number[]): string {
    const contributions = vector.map((value, index) => ({ feature: this.artifact.featureNames[index]!, value: value * this.artifact.coefficients[index]! })).filter((item) => Math.abs(item.value) > 1e-9);
    const positive = contributions.filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 3).map((item) => item.feature);
    const negative = contributions.filter((item) => item.value < 0).sort((a, b) => a.value - b.value).slice(0, 3).map((item) => item.feature);
    const details = [positive.length ? `Largest positive contributions: ${positive.join(", ")}` : null, negative.length ? `Largest negative contributions: ${negative.join(", ")}` : null].filter(Boolean).join(". ");
    return `Estimated by ${this.artifact.modelVersion} trained on ${this.artifact.datasetVersion}.${details ? ` ${details}.` : ""}`;
  }

  score(context: RecoveryContext): RecoveryScore[] {
    return RECOVERY_ACTION_TYPES.map((action) => {
      const vector = this.vector(context, action);
      const z = this.artifact.intercept + vector.reduce((sum, value, index) => sum + value * this.artifact.coefficients[index]!, 0);
      const probability = Math.min(1 - 1e-12, Math.max(1e-12, 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))))));
      return { action, probability, expectedRecoveredMinor: Math.round(probability * context.caseState.revenueAtRiskMinor), scorerVersion: this.artifact.modelVersion, datasetVersion: this.artifact.datasetVersion, explanation: this.explanation(vector) };
    });
  }
}
