"""Generate RecoveryIQ's reproducible synthetic recovery episodes."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RANDOM_SEED = 42
DATASET_VERSION = "synthetic-recovery-v1"
EPISODE_COUNT = 5_000

FAILURE_CATEGORIES = ["TEMPORARY_FUNDS", "BANK_OR_NETWORK", "PAYMENT_METHOD_INVALID", "CUSTOMER_AUTH_FAILURE", "MANDATE_OR_AUTH_INVALID", "UNKNOWN"]
FAILURE_CATEGORY_PROBABILITIES = [0.25, 0.20, 0.18, 0.15, 0.10, 0.12]
PAYMENT_METHODS = ["card", "upi", "emandate", "netbanking", "unknown"]
PAYMENT_METHOD_PROBABILITIES = [0.52, 0.24, 0.11, 0.10, 0.03]
ACTIONS = ["WAIT_NATIVE_RETRY", "SEND_NUDGE", "REQUEST_CARD_UPDATE", "STOP_AND_ESCALATE"]
ACTION_PROBABILITIES = [0.30, 0.27, 0.25, 0.18]

# Published simulation truth. These coefficients generate labels only and are not heuristic-v1.
GENERAL_EFFECTS = {
    "intercept": -0.65,
    "previousRecoveryRate": 1.05,
    "failureCount": -0.13,
    "previousNudges": -0.08,
    "subscriptionAgeLog": 0.08,
}
ACTION_EFFECTS = {"WAIT_NATIVE_RETRY": 0.10, "SEND_NUDGE": 0.08, "REQUEST_CARD_UPDATE": -0.05, "STOP_AND_ESCALATE": -0.75}
CATEGORY_EFFECTS = {"TEMPORARY_FUNDS": 0.25, "BANK_OR_NETWORK": 0.15, "PAYMENT_METHOD_INVALID": -0.15, "CUSTOMER_AUTH_FAILURE": -0.05, "MANDATE_OR_AUTH_INVALID": -0.55, "UNKNOWN": -0.25}
INTERACTIONS = {
    ("TEMPORARY_FUNDS", "SEND_NUDGE"): 0.70, ("TEMPORARY_FUNDS", "WAIT_NATIVE_RETRY"): 0.45,
    ("PAYMENT_METHOD_INVALID", "REQUEST_CARD_UPDATE"): 1.45, ("PAYMENT_METHOD_INVALID", "WAIT_NATIVE_RETRY"): -0.85,
    ("BANK_OR_NETWORK", "WAIT_NATIVE_RETRY"): 1.15, ("BANK_OR_NETWORK", "REQUEST_CARD_UPDATE"): -0.70,
    ("CUSTOMER_AUTH_FAILURE", "SEND_NUDGE"): 0.85,
    ("MANDATE_OR_AUTH_INVALID", "WAIT_NATIVE_RETRY"): -0.65, ("MANDATE_OR_AUTH_INVALID", "SEND_NUDGE"): -0.35,
}


def synthetic_success_probability(row: dict[str, object]) -> float:
    action = str(row["candidateAction"])
    category = str(row["failureCategory"])
    logit = GENERAL_EFFECTS["intercept"] + ACTION_EFFECTS[action] + CATEGORY_EFFECTS[category] + INTERACTIONS.get((category, action), 0.0)
    logit += GENERAL_EFFECTS["previousRecoveryRate"] * float(row["previousRecoveryRate"])
    logit += GENERAL_EFFECTS["failureCount"] * max(0, int(row["failureCount"]) - 1)
    logit += GENERAL_EFFECTS["previousNudges"] * int(row["previousNudges"])
    logit += GENERAL_EFFECTS["subscriptionAgeLog"] * np.log1p(int(row["subscriptionAgeDays"])) / np.log(365)
    if action == "WAIT_NATIVE_RETRY" and bool(row["nativeRetryPossible"]): logit += 0.75
    if action == "WAIT_NATIVE_RETRY" and bool(row["downtimeActive"]): logit += 0.65
    if action == "SEND_NUDGE" and bool(row["downtimeActive"]): logit -= 0.25
    if action == "WAIT_NATIVE_RETRY" and row["subscriptionStatus"] == "halted": logit -= 1.15
    if action == "SEND_NUDGE" and int(row["previousNudges"]) >= 2: logit -= 0.75
    return float(np.clip(1.0 / (1.0 + np.exp(-logit)), 0.02, 0.95))


def generate() -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)
    rows: list[dict[str, object]] = []
    for index in range(EPISODE_COUNT):
        category = str(rng.choice(FAILURE_CATEGORIES, p=FAILURE_CATEGORY_PROBABILITIES))
        status = str(rng.choice(["pending", "halted"], p=[0.78, 0.22]))
        confidence_probabilities = [0.62, 0.28, 0.10] if category != "UNKNOWN" else [0.08, 0.27, 0.65]
        previous_failed = int(np.clip(rng.poisson(2.1), 0, 12))
        recovered = int(rng.binomial(previous_failed, rng.beta(2.0, 3.2))) if previous_failed else 0
        downtime_active = bool(rng.random() < (0.22 if category == "BANK_OR_NETWORK" else 0.08))
        row: dict[str, object] = {
            "episodeId": f"episode_{index + 1:05d}",
            "amountMinor": int(rng.choice([29900, 69900, 149900], p=[0.42, 0.38, 0.20])),
            "failureCategory": category,
            "paymentMethod": str(rng.choice(PAYMENT_METHODS, p=PAYMENT_METHOD_PROBABILITIES)),
            "subscriptionStatus": status,
            "failureCount": int(np.clip(1 + rng.poisson(1.15), 1, 8)),
            "consecutiveFailureCount": int(np.clip(1 + rng.poisson(0.8), 1, 7)),
            "subscriptionAgeDays": int(np.clip(rng.gamma(2.2, 85), 1, 1_095)),
            "previousRecoveryRate": round(recovered / previous_failed, 6) if previous_failed else 0.0,
            "previousFailedPayments": previous_failed,
            "previousNudges": int(rng.choice([0, 1, 2, 3], p=[0.55, 0.27, 0.13, 0.05])),
            "nativeRetryPossible": status == "pending",
            "downtimeActive": downtime_active,
            "diagnosisConfidence": str(rng.choice(["HIGH", "MEDIUM", "LOW"], p=confidence_probabilities)),
            "candidateAction": str(rng.choice(ACTIONS, p=ACTION_PROBABILITIES)),
            "downtimeSeverity": str(rng.choice(["low", "medium", "high"], p=[0.25, 0.45, 0.30])) if downtime_active else "none",
            "caseAgeHours": round(float(np.clip(rng.gamma(1.8, 18), 0.1, 168)), 3),
        }
        probability = synthetic_success_probability(row)
        row["recoveredWithin7Days"] = int(rng.binomial(1, probability))
        rows.append(row)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    output = Path(__file__).parent / "data" / "synthetic_recovery_v1.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    frame = generate()
    frame.to_csv(output, index=False, lineterminator="\n")
    print(f"Generated {len(frame)} deterministic episodes at {output}")
    print(f"Positive outcome rate: {frame['recoveredWithin7Days'].mean():.6f}")
