import { runPolicyEvaluation, persistPolicyEvaluation } from "../src/evaluation/PolicyEvaluationRunner.js";

async function main(): Promise<void> {
  const shouldPersist = process.argv.includes("--persist");
  const { report, reportHash } = await runPolicyEvaluation();
  if (shouldPersist) {
    const { connectDatabase, disconnectDatabase } = await import("../src/config/database.js");
    await connectDatabase();
    try { await persistPolicyEvaluation(report, reportHash); }
    finally { await disconnectDatabase(); }
  }
  const result = report.strategies.RECOVERYIQ_LOGISTIC_POLICY;
  console.log(JSON.stringify({
    evaluationVersion: report.evaluationVersion,
    datasetHash: report.datasetHash,
    reportHash,
    episodeCount: report.episodeCount,
    simulatedExpectedRecoveredRevenueMinor: result.expectedRecoveredRevenueMinor,
    simulatedRealizedRecoveredRevenueMinor: result.realizedRecoveredRevenueMinor,
    persisted: shouldPersist,
  }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
