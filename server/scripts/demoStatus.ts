import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { EvaluationRun } from "../src/models/EvaluationRun.js";
import { RecoveryCase } from "../src/models/RecoveryCase.js";

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const [caseCount, casesByStatus, latestEvaluation] = await Promise.all([
      RecoveryCase.countDocuments(),
      RecoveryCase.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      EvaluationRun.findOne({ evaluationVersion: "policy-eval-v1" }).sort({ createdAt: -1 }).select("evaluationVersion datasetVersion episodeCount createdAt").lean(),
    ]);
    console.log(JSON.stringify({
      database: "connected",
      razorpayTestModeConfigured: env.RAZORPAY_KEY_ID.startsWith("rzp_test_") && Boolean(env.RAZORPAY_KEY_SECRET) && Boolean(env.RAZORPAY_WEBHOOK_SECRET),
      scorerMode: env.RECOVERY_SCORER,
      notificationMode: env.RECOVERY_NOTIFICATION_MODE,
      recoveryCases: { total: caseCount, byStatus: Object.fromEntries(casesByStatus.map((item) => [item._id, item.count])) },
      latestEvaluation: latestEvaluation ? { evaluationVersion: latestEvaluation.evaluationVersion, datasetVersion: latestEvaluation.datasetVersion, episodeCount: latestEvaluation.episodeCount, createdAt: latestEvaluation.createdAt } : null,
    }, null, 2));
  } finally { await disconnectDatabase(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Demo readiness check failed."); process.exitCode = 1; });
