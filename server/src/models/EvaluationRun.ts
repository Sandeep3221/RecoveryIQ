import { Schema, model, models, type Model } from "mongoose";

export interface EvaluationRunDocument {
  evaluationVersion?: string;
  datasetVersion: string;
  modelVersion: string;
  policyVersion: string;
  seed?: number;
  episodeCount?: number;
  datasetHash?: string;
  reportHash?: string;
  generatedAt?: string;
  disclaimer?: string;
  strategies?: unknown;
  comparisons?: unknown;
  logisticVsHeuristic?: unknown;
  policySafety?: unknown;
  productionInvocations?: unknown;
  createdAt: Date;
}

const evaluationRunSchema = new Schema({
  evaluationVersion: { type: String, index: true },
  datasetVersion: { type: String, required: true }, modelVersion: { type: String, required: true }, policyVersion: { type: String, required: true },
  seed: Number, episodeCount: Number, datasetHash: { type: String, index: true }, reportHash: String,
  generatedAt: String, disclaimer: String,
  strategies: Schema.Types.Mixed, comparisons: Schema.Types.Mixed, logisticVsHeuristic: Schema.Types.Mixed,
  policySafety: Schema.Types.Mixed, productionInvocations: Schema.Types.Mixed,
  // Optional legacy Stage 1 fields remain readable for pre-existing evaluation records.
  sampleCount: Number, revenueAtRiskMinor: Number, baseline: Schema.Types.Mixed, recoveryIQ: Schema.Types.Mixed,
  comparison: Schema.Types.Mixed, modelMetrics: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
}, { collection: "evaluationRuns" });
export const EvaluationRun =
  (models.EvaluationRun as Model<EvaluationRunDocument> | undefined)
  ?? model<EvaluationRunDocument>("EvaluationRun", evaluationRunSchema);
