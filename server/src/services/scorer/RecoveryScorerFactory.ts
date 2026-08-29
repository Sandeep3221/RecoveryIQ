import { env } from "../../config/env.js";
import type { RecoveryScorer } from "./RecoveryScorer.js";
import { heuristicRecoveryScorer } from "./HeuristicRecoveryScorer.js";
import { LogisticRecoveryScorer } from "./LogisticRecoveryScorer.js";

let configuredLogisticScorer: LogisticRecoveryScorer | null = null;

export function createRecoveryScorer(kind: "heuristic" | "logistic", artifactPath?: string): RecoveryScorer {
  if (kind === "heuristic") return heuristicRecoveryScorer;
  return new LogisticRecoveryScorer(artifactPath);
}

export function getConfiguredRecoveryScorer(): RecoveryScorer {
  if (env.RECOVERY_SCORER === "heuristic") return heuristicRecoveryScorer;
  configuredLogisticScorer ??= new LogisticRecoveryScorer();
  return configuredLogisticScorer;
}
