import type { RecoveryContext } from "../../domain/recovery/RecoveryContext.js";
import type { RecoveryActionType } from "../../domain/types.js";

export interface RecoveryScore {
  action: RecoveryActionType;
  probability: number;
  expectedRecoveredMinor: number;
  scorerVersion: string;
  datasetVersion?: string;
  explanation: string;
}

export interface RecoveryScorer {
  score(context: RecoveryContext): RecoveryScore[];
}
