"""Evaluate logistic-v1 and heuristic-v1 on the same untouched synthetic test rows."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss, f1_score, log_loss, precision_score, recall_score, roc_auc_score

from feature_engineering import artifact_probabilities, load_artifact, split_dataset

ROOT = Path(__file__).parent
DISCLAIMER = "RecoveryIQ's Stage 5B model is trained and evaluated on synthetic recovery episodes because production merchant subscription-failure histories are unavailable. The dataset generator and assumptions are published. Model metrics and recovery probabilities are simulation results and must not be interpreted as real-world merchant performance."

HEURISTIC_BASES = {
    "TEMPORARY_FUNDS": [0.60, 0.72, 0.15, 0.05], "PAYMENT_METHOD_INVALID": [0.10, 0.35, 0.82, 0.10],
    "BANK_OR_NETWORK": [0.75, 0.30, 0.10, 0.05], "CUSTOMER_AUTH_FAILURE": [0.30, 0.65, 0.25, 0.08],
    "MANDATE_OR_AUTH_INVALID": [0.05, 0.20, 0.35, 0.55], "UNKNOWN": [0.40, 0.35, 0.20, 0.15],
}
ACTIONS = ["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"]


def heuristic_probability(row: pd.Series) -> float:
    action = str(row["candidateAction"])
    index = ACTIONS.index(action)
    value = HEURISTIC_BASES[str(row["failureCategory"])][index]
    if action == "WAIT_NATIVE_RETRY": value += 0.10 if bool(row["nativeRetryPossible"]) else -0.30
    if bool(row["downtimeActive"]): value += {"WAIT_NATIVE_RETRY": 0.15, "SEND_NUDGE": -0.10, "REQUEST_CARD_UPDATE": -0.10}.get(action, 0)
    if int(row["failureCount"]) >= 3: value += {"WAIT_NATIVE_RETRY": -0.15, "STOP_AND_ESCALATE": 0.15}.get(action, 0)
    if float(row["previousRecoveryRate"]) >= 0.5: value += {"WAIT_NATIVE_RETRY": 0.05, "SEND_NUDGE": 0.05}.get(action, 0)
    if action == "SEND_NUDGE" and int(row["previousNudges"]) >= 2: value -= 0.25
    if row["subscriptionStatus"] == "halted": value += {"WAIT_NATIVE_RETRY": -0.30, "REQUEST_CARD_UPDATE": 0.10, "STOP_AND_ESCALATE": 0.10}.get(action, 0)
    if row["diagnosisConfidence"] == "LOW": value += {"SEND_NUDGE": -0.05, "REQUEST_CARD_UPDATE": -0.05}.get(action, 0)
    return round(float(np.clip(value, 0.01, 0.99)), 2)


def metrics(y: np.ndarray, probability: np.ndarray) -> dict[str, float]:
    predicted = (probability >= 0.5).astype(int)
    return {"accuracy": accuracy_score(y, predicted), "precision": precision_score(y, predicted, zero_division=0), "recall": recall_score(y, predicted, zero_division=0), "f1": f1_score(y, predicted, zero_division=0), "rocAuc": roc_auc_score(y, probability), "logLoss": log_loss(y, probability), "brierScore": brier_score_loss(y, probability)}


def rounded(values: dict[str, float]) -> dict[str, float]: return {key: round(float(value), 6) for key, value in values.items()}


def main() -> None:
    frame = pd.read_csv(ROOT / "data" / "synthetic_recovery_v1.csv")
    train, test = split_dataset(frame)
    artifact = load_artifact(ROOT / "artifacts" / "logistic_recovery_v1.json")
    y = test["recoveredWithin7Days"].to_numpy()
    logistic = artifact_probabilities(test, artifact)
    heuristic = test.apply(heuristic_probability, axis=1).to_numpy()
    per_action = {}
    for action, group in test.groupby("candidateAction"):
        indexes = test.index.get_indexer(group.index)
        action_y = group["recoveredWithin7Days"].to_numpy()
        action_p = logistic[indexes]
        per_action[action] = {"sampleCount": len(group), "actualRecoveryRate": round(float(action_y.mean()), 6), "meanPredictedProbability": round(float(action_p.mean()), 6), "brierScore": round(float(brier_score_loss(action_y, action_p)), 6)}
    calibration = []
    for lower in np.arange(0, 1, 0.1):
        upper = round(float(lower + 0.1), 1)
        mask = (logistic >= lower) & (logistic < upper if upper < 1 else logistic <= upper)
        calibration.append({"bucket": f"{lower:.1f}-{upper:.1f}", "sampleCount": int(mask.sum()), "meanPredictedProbability": round(float(logistic[mask].mean()), 6) if mask.any() else None, "actualRecoveryRate": round(float(y[mask].mean()), 6) if mask.any() else None})
    coefficients = sorted(zip(artifact["featureNames"], artifact["coefficients"]), key=lambda pair: abs(pair[1]), reverse=True)[:15]
    report = {
        "disclaimer": DISCLAIMER,
        "dataset": {"version": "synthetic-recovery-v1", "episodeCount": len(frame), "trainCount": len(train), "testCount": len(test), "positiveOutcomeRate": round(float(frame["recoveredWithin7Days"].mean()), 6), "randomSeed": 42},
        "model": {"version": "logistic-v1", "type": "sklearn.linear_model.LogisticRegression", "featureCount": len(artifact["featureNames"]), "topAbsoluteCoefficients": [{"feature": name, "coefficient": round(float(value), 6)} for name, value in coefficients]},
        "globalMetrics": rounded(metrics(y, logistic)), "perActionMetrics": per_action, "calibration": calibration,
        "heuristicComparison": {"sameHeldOutRows": True, "logistic": {key: value for key, value in rounded(metrics(y, logistic)).items() if key in ["brierScore", "logLoss", "rocAuc"]}, "heuristic": {key: value for key, value in rounded(metrics(y, heuristic)).items() if key in ["brierScore", "logLoss", "rocAuc"]}},
        "limitations": ["All episodes and outcomes are synthetic simulation data.", "No merchant production outcomes or causal treatment effects were used.", "Per-action estimates are predictive simulation results, not permitted-action decisions or revenue uplift."],
    }
    reports = ROOT / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "evaluation_v1.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    m = report["globalMetrics"]
    lines = ["# RecoveryIQ Stage 5B Evaluation", "", DISCLAIMER, "", "## Dataset", "", f"- Episodes: {len(frame)}", f"- Train/test: {len(train)}/{len(test)}", f"- Positive outcome rate: {report['dataset']['positiveOutcomeRate']:.2%}", f"- Features after encoding: {report['model']['featureCount']}", "", "## Held-out metrics", "", "| Accuracy | Precision | Recall | F1 | ROC-AUC | Log Loss | Brier Score |", "|---:|---:|---:|---:|---:|---:|---:|", f"| {m['accuracy']:.4f} | {m['precision']:.4f} | {m['recall']:.4f} | {m['f1']:.4f} | {m['rocAuc']:.4f} | {m['logLoss']:.4f} | {m['brierScore']:.4f} |", "", "Brier Score is included because RecoveryIQ needs probability quality, not only binary classification accuracy.", "", "## Per-action metrics", "", "| Action | Samples | Actual rate | Mean prediction | Brier |", "|---|---:|---:|---:|---:|"]
    for action in ACTIONS:
        item = per_action[action]
        lines.append(f"| {action} | {item['sampleCount']} | {item['actualRecoveryRate']:.4f} | {item['meanPredictedProbability']:.4f} | {item['brierScore']:.4f} |")
    comparison = report["heuristicComparison"]
    lines.extend(["", "## Heuristic vs Logistic", "", "Both scorers were evaluated on the identical held-out rows and observed candidate actions.", "", "| Scorer | Brier | Log Loss | ROC-AUC |", "|---|---:|---:|---:|", f"| logistic-v1 | {comparison['logistic']['brierScore']:.4f} | {comparison['logistic']['logLoss']:.4f} | {comparison['logistic']['rocAuc']:.4f} |", f"| heuristic-v1 | {comparison['heuristic']['brierScore']:.4f} | {comparison['heuristic']['logLoss']:.4f} | {comparison['heuristic']['rocAuc']:.4f} |", "", "## Calibration", "", "| Bucket | Samples | Mean prediction | Actual rate |", "|---|---:|---:|---:|"])
    for item in calibration:
        mean = "n/a" if item["meanPredictedProbability"] is None else f"{item['meanPredictedProbability']:.4f}"
        actual = "n/a" if item["actualRecoveryRate"] is None else f"{item['actualRecoveryRate']:.4f}"
        lines.append(f"| {item['bucket']} | {item['sampleCount']} | {mean} | {actual} |")
    lines.extend(["", "## Limitations", "", *[f"- {item}" for item in report["limitations"]]])
    (reports / "evaluation_v1.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Evaluated on {len(test)} untouched rows")
    print(json.dumps(report["globalMetrics"], indent=2))


if __name__ == "__main__":
    main()
