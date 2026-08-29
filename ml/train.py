"""Train logistic-v1 and export a portable JSON artifact plus parity fixtures."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression

from feature_engineering import (
    ACTIONS, CATEGORICAL_DEFAULTS, CATEGORICAL_VALUES, NUMERIC_FEATURES,
    apply_scaler, artifact_probabilities, feature_names, fit_numeric_scaler,
    raw_feature_rows, split_dataset,
)

ROOT = Path(__file__).parent
DATASET_VERSION = "synthetic-recovery-v1"
MODEL_VERSION = "logistic-v1"
ARTIFACT_PATH = ROOT / "artifacts" / "logistic_recovery_v1.json"
SCHEMA_PATH = ROOT / "artifacts" / "feature_schema_v1.json"
PARITY_PATH = ROOT / "artifacts" / "parity_v1.json"
SERVER_MODEL_DIR = ROOT.parent / "server" / "src" / "services" / "scorer" / "models"


def parity_contexts() -> list[dict[str, object]]:
    return [
        {"name": "unknown-card-pending-downtime", "context": {"caseId": "parity_1", "subscription": {"id": "sub_1", "status": "pending", "amountMinor": 69900, "ageDays": 12, "nativeRetryPossible": True}, "failure": {"category": "UNKNOWN", "reason": None, "source": None, "step": None, "paymentMethod": "card", "failureCount": 1, "consecutiveFailureCount": 1}, "customerHistory": {"previousSuccessfulPayments": 0, "previousFailedPayments": 1, "previousRecoveredPayments": 0, "previousRecoveryRate": 0.0, "previousNudges": 0, "hoursSinceLastNudge": None}, "diagnosis": {"classifierVersion": "classifier-v1", "confidence": "LOW", "explanation": "Parity"}, "downtime": {"checked": True, "active": True, "method": "card", "severity": "high", "matchLevel": "EXACT"}, "caseState": {"caseAgeHours": 1.5, "revenueAtRiskMinor": 69900, "previousActions": []}}},
        {"name": "invalid-card-halted", "context": {"caseId": "parity_2", "subscription": {"id": "sub_2", "status": "halted", "amountMinor": 149900, "ageDays": 240, "nativeRetryPossible": False}, "failure": {"category": "PAYMENT_METHOD_INVALID", "reason": "card_expired", "source": "customer", "step": "payment_authentication", "paymentMethod": "card", "failureCount": 4, "consecutiveFailureCount": 3}, "customerHistory": {"previousSuccessfulPayments": 8, "previousFailedPayments": 4, "previousRecoveredPayments": 1, "previousRecoveryRate": 0.25, "previousNudges": 2, "hoursSinceLastNudge": 48}, "diagnosis": {"classifierVersion": "classifier-v1", "confidence": "HIGH", "explanation": "Parity"}, "downtime": {"checked": True, "active": False, "method": "card", "severity": None, "matchLevel": "NONE"}, "caseState": {"caseAgeHours": 36, "revenueAtRiskMinor": 149900, "previousActions": []}}},
        {"name": "bank-upi-pending", "context": {"caseId": "parity_3", "subscription": {"id": "sub_3", "status": "pending", "amountMinor": 29900, "ageDays": 75, "nativeRetryPossible": True}, "failure": {"category": "BANK_OR_NETWORK", "reason": None, "source": "bank", "step": None, "paymentMethod": "upi", "failureCount": 2, "consecutiveFailureCount": 2}, "customerHistory": {"previousSuccessfulPayments": 5, "previousFailedPayments": 3, "previousRecoveredPayments": 2, "previousRecoveryRate": 0.666667, "previousNudges": 1, "hoursSinceLastNudge": 30}, "diagnosis": {"classifierVersion": "classifier-v1", "confidence": "MEDIUM", "explanation": "Parity"}, "downtime": {"checked": True, "active": False, "method": "upi", "severity": "medium", "matchLevel": "METHOD_ONLY"}, "caseState": {"caseAgeHours": 8, "revenueAtRiskMinor": 29900, "previousActions": []}}},
        {"name": "unknown-categories-safe", "context": {"caseId": "parity_4", "subscription": {"id": "sub_4", "status": "unknown", "amountMinor": 69900, "ageDays": 3, "nativeRetryPossible": False}, "failure": {"category": "UNKNOWN", "reason": None, "source": None, "step": None, "paymentMethod": "unknown", "failureCount": 1, "consecutiveFailureCount": 1}, "customerHistory": {"previousSuccessfulPayments": 0, "previousFailedPayments": 0, "previousRecoveredPayments": 0, "previousRecoveryRate": 0.0, "previousNudges": 0, "hoursSinceLastNudge": None}, "diagnosis": {"classifierVersion": "classifier-v1", "confidence": "LOW", "explanation": "Parity"}, "downtime": {"checked": False, "active": False, "method": None, "severity": None, "matchLevel": "UNKNOWN"}, "caseState": {"caseAgeHours": 2, "revenueAtRiskMinor": 69900, "previousActions": []}}},
    ]


def context_rows(context: dict[str, object]) -> pd.DataFrame:
    subscription = context["subscription"]
    failure = context["failure"]
    history = context["customerHistory"]
    diagnosis = context["diagnosis"]
    downtime = context["downtime"]
    case_state = context["caseState"]
    base = {
        "amountMinor": subscription["amountMinor"], "failureCategory": failure["category"], "paymentMethod": failure["paymentMethod"],
        "subscriptionStatus": subscription["status"], "failureCount": failure["failureCount"], "consecutiveFailureCount": failure["consecutiveFailureCount"],
        "subscriptionAgeDays": subscription["ageDays"], "previousRecoveryRate": history["previousRecoveryRate"], "previousFailedPayments": history["previousFailedPayments"],
        "previousNudges": history["previousNudges"], "nativeRetryPossible": subscription["nativeRetryPossible"], "downtimeActive": downtime["active"],
        "diagnosisConfidence": diagnosis["confidence"], "downtimeSeverity": downtime["severity"] or "none", "caseAgeHours": case_state["caseAgeHours"],
    }
    return pd.DataFrame([{**base, "candidateAction": action} for action in ACTIONS])


def main() -> None:
    frame = pd.read_csv(ROOT / "data" / "synthetic_recovery_v1.csv")
    train, _ = split_dataset(frame)
    raw_train = raw_feature_rows(train)
    means, scales = fit_numeric_scaler(raw_train)
    features = apply_scaler(raw_train, means, scales)
    model = LogisticRegression(max_iter=2_000, random_state=42)
    model.fit(features, train["recoveredWithin7Days"].to_numpy())
    artifact = {
        "modelVersion": MODEL_VERSION, "datasetVersion": DATASET_VERSION, "randomSeed": 42,
        "target": "recoveredWithin7Days", "featureNames": feature_names(), "numericFeatures": NUMERIC_FEATURES,
        "categoricalValues": CATEGORICAL_VALUES, "categoricalDefaults": CATEGORICAL_DEFAULTS,
        "scaler": {"means": means.tolist(), "scales": scales.tolist()},
        "coefficients": model.coef_[0].tolist(), "intercept": float(model.intercept_[0]),
        "training": {"library": "scikit-learn", "version": sklearn.__version__, "trainRows": len(train), "maxIter": 2_000},
    }
    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_PATH.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    schema = {key: artifact[key] for key in ["modelVersion", "datasetVersion", "target", "featureNames", "numericFeatures", "categoricalValues", "categoricalDefaults"]}
    SCHEMA_PATH.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    fixtures = []
    for fixture in parity_contexts():
        probabilities = artifact_probabilities(context_rows(fixture["context"]), artifact)
        fixtures.append({**fixture, "expectedProbabilities": {action: float(probability) for action, probability in zip(ACTIONS, probabilities)}})
    PARITY_PATH.write_text(json.dumps({"modelVersion": MODEL_VERSION, "tolerance": 1e-6, "fixtures": fixtures}, indent=2) + "\n", encoding="utf-8")
    SERVER_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ARTIFACT_PATH, SERVER_MODEL_DIR / ARTIFACT_PATH.name)
    shutil.copy2(PARITY_PATH, SERVER_MODEL_DIR / PARITY_PATH.name)
    print(f"Trained {MODEL_VERSION} on {len(train)} rows")
    print(f"Wrote portable artifact to {ARTIFACT_PATH}")


if __name__ == "__main__":
    main()
