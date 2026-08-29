#!/usr/bin/env python3
"""Generate fresh, evaluation-only contexts for synthetic-policy-eval-v1."""

from __future__ import annotations

import hashlib
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from generate_dataset import (  # noqa: E402
    ACTIONS,
    FAILURE_CATEGORIES,
    FAILURE_CATEGORY_PROBABILITIES,
    PAYMENT_METHODS,
    PAYMENT_METHOD_PROBABILITIES,
    synthetic_success_probability,
)

DATASET_VERSION = "synthetic-policy-eval-v1"
POLICY_EVAL_SEED = 4242
CONTEXT_COUNT = 10_000
OUTPUT = ROOT / "data" / "synthetic_policy_eval_v1.jsonl"
AMOUNTS_MINOR = [29_900, 49_900, 69_900, 99_900, 149_900, 249_900]
AMOUNT_PROBS = [0.24, 0.14, 0.26, 0.12, 0.16, 0.08]
STATUSES = ["pending", "halted"]
STATUS_PROBS = [0.78, 0.22]
CONFIDENCES = ["HIGH", "MEDIUM", "LOW"]


def choice(rng: random.Random, values: list, weights: list[float]):
    return rng.choices(values, weights=weights, k=1)[0]


def generate_context(rng: random.Random, index: int) -> dict:
    category = choice(rng, FAILURE_CATEGORIES, FAILURE_CATEGORY_PROBABILITIES)
    payment_method = choice(rng, PAYMENT_METHODS, PAYMENT_METHOD_PROBABILITIES)
    status = choice(rng, STATUSES, STATUS_PROBS)
    amount_minor = choice(rng, AMOUNTS_MINOR, AMOUNT_PROBS)
    native_retry = status == "pending" and rng.random() < 0.76
    downtime_active = payment_method in {"card", "upi", "netbanking"} and rng.random() < 0.12
    previous_successful = min(18, int(rng.expovariate(1 / 3.2)))
    previous_failed = min(8, int(rng.expovariate(1 / 1.25)))
    previous_recovered = min(previous_failed, sum(rng.random() < 0.54 for _ in range(previous_failed)))
    previous_nudges = choice(rng, [0, 1, 2, 3], [0.60, 0.23, 0.12, 0.05])
    hours_since_last_nudge = None if previous_nudges == 0 else choice(rng, [6, 12, 24, 48, 72], [0.16, 0.18, 0.22, 0.25, 0.19])
    failure_count = min(7, 1 + int(rng.expovariate(1 / 1.15)))
    consecutive_failure_count = rng.randint(1, failure_count)
    subscription_age_days = min(720, max(1, int(math.exp(rng.normalvariate(3.45, 1.0)))))
    case_age_hours = min(240, int(rng.expovariate(1 / 49)))
    confidence_probs = [0.62, 0.28, 0.10] if category != "UNKNOWN" else [0.08, 0.27, 0.65]
    confidence = choice(rng, CONFIDENCES, confidence_probs)
    recovery_rate = previous_recovered / previous_failed if previous_failed else 0.0

    simulator_row = {
        "failureCategory": category,
        "paymentMethod": payment_method,
        "subscriptionStatus": status,
        "nativeRetryPossible": int(native_retry),
        "downtimeActive": int(downtime_active),
        "previousRecoveryRate": recovery_rate,
        "failureCount": failure_count,
        "previousNudges": previous_nudges,
        "subscriptionAgeDays": subscription_age_days,
    }
    ground_truth = {}
    for action in ACTIONS:
        ground_truth[action] = round(synthetic_success_probability({**simulator_row, "candidateAction": action}), 12)

    return {
        "contextId": f"policy-eval-{index + 1:05d}",
        "context": {
            "caseId": f"policy-eval-{index + 1:05d}",
            "subscription": {
                "id": f"synthetic-sub-{index + 1:05d}",
                "status": status,
                "amountMinor": amount_minor,
                "ageDays": subscription_age_days,
                "nativeRetryPossible": native_retry,
            },
            "failure": {
                "category": category,
                "reason": None,
                "source": None,
                "step": None,
                "paymentMethod": payment_method,
                "failureCount": failure_count,
                "consecutiveFailureCount": consecutive_failure_count,
            },
            "customerHistory": {
                "previousSuccessfulPayments": previous_successful,
                "previousFailedPayments": previous_failed,
                "previousRecoveredPayments": previous_recovered,
                "previousRecoveryRate": recovery_rate,
                "previousNudges": previous_nudges,
                "hoursSinceLastNudge": hours_since_last_nudge,
            },
            "diagnosis": {
                "classifierVersion": "classifier-v1",
                "confidence": confidence,
                "explanation": "Evaluation-only synthetic context.",
            },
            "downtime": {
                "checked": True,
                "active": downtime_active,
                "method": payment_method if downtime_active else None,
                "severity": choice(rng, ["low", "medium", "high"], [0.25, 0.5, 0.25]) if downtime_active else None,
                "matchLevel": "EXACT" if downtime_active else "NONE",
            },
            "caseState": {
                "caseAgeHours": case_age_hours,
                "revenueAtRiskMinor": amount_minor,
                "previousActions": [],
            },
        },
        "groundTruth": ground_truth,
        "randomDraw": round(rng.random(), 12),
    }


def main() -> None:
    rng = random.Random(POLICY_EVAL_SEED)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="\n") as target:
        for index in range(CONTEXT_COUNT):
            target.write(json.dumps(generate_context(rng, index), sort_keys=True, separators=(",", ":")) + "\n")
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    print(f"Generated {CONTEXT_COUNT} contexts at {OUTPUT}")
    print(f"datasetVersion={DATASET_VERSION} seed={POLICY_EVAL_SEED} sha256={digest}")


if __name__ == "__main__":
    main()
