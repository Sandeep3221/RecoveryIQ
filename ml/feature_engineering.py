"""Shared, explicit feature encoding used by training, evaluation, and parity fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

NUMERIC_FEATURES = [
    "amountMinor", "failureCount", "consecutiveFailureCount", "subscriptionAgeDays",
    "previousRecoveryRate", "previousFailedPayments", "previousNudges",
    "nativeRetryPossible", "downtimeActive", "caseAgeHours",
]

CATEGORICAL_VALUES = {
    "failureCategory": ["TEMPORARY_FUNDS", "PAYMENT_METHOD_INVALID", "BANK_OR_NETWORK", "CUSTOMER_AUTH_FAILURE", "MANDATE_OR_AUTH_INVALID", "UNKNOWN"],
    "paymentMethod": ["card", "upi", "emandate", "netbanking", "unknown"],
    "subscriptionStatus": ["pending", "halted", "unknown"],
    "diagnosisConfidence": ["HIGH", "MEDIUM", "LOW"],
    "candidateAction": ["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"],
    "downtimeSeverity": ["low", "medium", "high", "none", "unknown"],
}

CATEGORICAL_DEFAULTS = {
    "failureCategory": "UNKNOWN", "paymentMethod": "unknown", "subscriptionStatus": "unknown",
    "diagnosisConfidence": "LOW", "downtimeSeverity": "unknown",
}

ACTIONS = CATEGORICAL_VALUES["candidateAction"]


def split_dataset(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    train, test = train_test_split(frame, test_size=0.20, random_state=42, stratify=frame["recoveredWithin7Days"])
    return train.sort_index(), test.sort_index()


def feature_names() -> list[str]:
    names = list(NUMERIC_FEATURES)
    for column, values in CATEGORICAL_VALUES.items():
        names.extend(f"{column}={value}" for value in values)
    names.extend(f"failureCategory={category}|candidateAction={action}" for category in CATEGORICAL_VALUES["failureCategory"] for action in ACTIONS)
    names.extend(f"candidateAction={action}|nativeRetryPossible=1" for action in ACTIONS)
    names.extend(f"candidateAction={action}|downtimeActive=1" for action in ACTIONS)
    names.extend(f"candidateAction={action}|halted=1" for action in ACTIONS)
    names.extend(f"candidateAction={action}|previousNudges>=2" for action in ACTIONS)
    return names


def normalize_category(column: str, value: Any) -> str:
    text = str(value) if value is not None and not pd.isna(value) else CATEGORICAL_DEFAULTS.get(column, "")
    allowed = CATEGORICAL_VALUES[column]
    if text in allowed:
        return text
    if column == "candidateAction":
        raise ValueError(f"Unsupported candidate action: {text}")
    return CATEGORICAL_DEFAULTS[column]


def raw_feature_rows(frame: pd.DataFrame) -> np.ndarray:
    names = feature_names()
    index = {name: position for position, name in enumerate(names)}
    matrix = np.zeros((len(frame), len(names)), dtype=float)
    for row_number, (_, row) in enumerate(frame.iterrows()):
        for numeric in NUMERIC_FEATURES:
            matrix[row_number, index[numeric]] = float(row[numeric])
        categories = {column: normalize_category(column, row[column]) for column in CATEGORICAL_VALUES}
        for column, value in categories.items():
            matrix[row_number, index[f"{column}={value}"]] = 1.0
        action = categories["candidateAction"]
        matrix[row_number, index[f"failureCategory={categories['failureCategory']}|candidateAction={action}"]] = 1.0
        if float(row["nativeRetryPossible"]) == 1:
            matrix[row_number, index[f"candidateAction={action}|nativeRetryPossible=1"]] = 1.0
        if float(row["downtimeActive"]) == 1:
            matrix[row_number, index[f"candidateAction={action}|downtimeActive=1"]] = 1.0
        if categories["subscriptionStatus"] == "halted":
            matrix[row_number, index[f"candidateAction={action}|halted=1"]] = 1.0
        if float(row["previousNudges"]) >= 2:
            matrix[row_number, index[f"candidateAction={action}|previousNudges>=2"]] = 1.0
    return matrix


def fit_numeric_scaler(raw: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    count = len(NUMERIC_FEATURES)
    means = raw[:, :count].mean(axis=0)
    scales = raw[:, :count].std(axis=0)
    scales[scales == 0] = 1.0
    return means, scales


def apply_scaler(raw: np.ndarray, means: np.ndarray, scales: np.ndarray) -> np.ndarray:
    result = raw.copy()
    count = len(NUMERIC_FEATURES)
    result[:, :count] = (result[:, :count] - means) / scales
    return result


def load_artifact(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def artifact_probabilities(frame: pd.DataFrame, artifact: dict[str, Any]) -> np.ndarray:
    raw = raw_feature_rows(frame)
    means = np.asarray(artifact["scaler"]["means"], dtype=float)
    scales = np.asarray(artifact["scaler"]["scales"], dtype=float)
    features = apply_scaler(raw, means, scales)
    coefficients = np.asarray(artifact["coefficients"], dtype=float)
    logits = float(artifact["intercept"]) + features @ coefficients
    return 1.0 / (1.0 + np.exp(-np.clip(logits, -35, 35)))
