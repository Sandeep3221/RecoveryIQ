import type { PolicyReasonCode, RecoveryActionType } from "../types.js";

export interface BlockedRecoveryAction {
  action: RecoveryActionType;
  reasonCode: PolicyReasonCode;
  explanation: string;
}

export interface RecoveryDecision {
  decisionId?: string;
  policyVersion: string;
  scorerVersion: string;
  selectedAction: RecoveryActionType;
  selectedProbability: number;
  expectedRecoveredMinor: number;
  reasonCode: PolicyReasonCode;
  explanation: string;
  hardRuleApplied: boolean;
  allowedActions: RecoveryActionType[];
  blockedActions: BlockedRecoveryAction[];
  decidedAt: Date;
}
