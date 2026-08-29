import { createHash } from "node:crypto";
import type { RecoveryDecision } from "../../domain/recovery/RecoveryDecision.js";

export function recoveryDecisionId(caseId: string, decision: RecoveryDecision): string {
  const source = [caseId, decision.policyVersion, decision.scorerVersion, decision.selectedAction, new Date(decision.decidedAt).toISOString()].join("|");
  return `decision_${createHash("sha256").update(source).digest("hex")}`;
}
