# Synthetic Policy Evaluation v1

> **SYNTHETIC / SIMULATED / CONTROLLED EVALUATION.** All figures are synthetic simulation results and do not represent actual merchant uplift.

## Evaluation Setup

- Dataset: synthetic-policy-eval-v1
- Seed: 4242
- Fresh contexts: 10,000
- Dataset SHA-256: `d25444880ae3a1dbbdbbba689f1a9c064b0fe778fb06a7d8f5ce3452cd22e24a`
- Frozen model: logistic-v1
- Deterministic policy: policy-v1

The evaluation rows are one recovery context each. Hidden per-action probabilities and a shared random draw are evaluation-only and are applied only after the production scorer and policy choose an action. Amounts are sampled from ₹299, ₹499, ₹699, ₹999, ₹1,499, and ₹2,499 plans.

## Synthetic Data Disclaimer

All Stage 9 revenue and uplift figures are generated inside synthetic-policy-eval-v1. They do not represent actual Razorpay merchant recovery performance. RecoveryIQ's real Razorpay integration validates data flow and operational behavior; Stage 9 validates policy behavior only inside a controlled simulation.

## Strategies

RecoveryIQ uses the production LogisticRecoveryScorer and policy-v1. Heuristic Policy swaps in heuristic-v1 while holding policy-v1 fixed. Retry First waits only when pending native retry is feasible. Nudge First contacts the customer when merchant-policy contact guards allow. STOP_AND_ESCALATE's probability represents later external/manual resolution; STOP does not itself collect payment.

## Overall Results

| Strategy | Simulated expected recovered | Simulated realized recovered | Expected rate | Realized rate | Customer interventions |
|---|---:|---:|---:|---:|---:|
| RecoveryIQ Logistic + Policy | ₹47,97,642 | ₹48,07,693 | 54.80% | 54.91% | 3,622 |
| Heuristic + Policy | ₹47,24,625 | ₹47,35,575 | 53.96% | 54.09% | 5,082 |
| Retry First | ₹39,24,632 | ₹39,35,919 | 44.83% | 44.96% | 0 |
| Nudge First | ₹39,66,631 | ₹39,91,582 | 45.31% | 45.59% | 7,515 |

## Simulated Revenue Comparison

- Versus HEURISTIC_POLICY: simulated expected delta ₹73,017 (1.55%); simulated realized delta ₹72,118.
- Versus NAIVE_RETRY_FIRST: simulated expected delta ₹8,73,010 (22.24%); simulated realized delta ₹8,71,774.
- Versus NAIVE_NUDGE_FIRST: simulated expected delta ₹8,31,012 (20.95%); simulated realized delta ₹8,16,111.

## Action Distribution

- RecoveryIQ Logistic + Policy: WAIT_NATIVE_RETRY 4086, SEND_NUDGE 1860, REQUEST_CARD_UPDATE 1762, STOP_AND_ESCALATE 2292.
- Heuristic + Policy: WAIT_NATIVE_RETRY 2615, SEND_NUDGE 3320, REQUEST_CARD_UPDATE 1762, STOP_AND_ESCALATE 2303.
- Retry First: WAIT_NATIVE_RETRY 5914, SEND_NUDGE 0, REQUEST_CARD_UPDATE 0, STOP_AND_ESCALATE 4086.
- Nudge First: WAIT_NATIVE_RETRY 1452, SEND_NUDGE 7515, REQUEST_CARD_UPDATE 0, STOP_AND_ESCALATE 1033.

## Customer Intervention Comparison

RecoveryIQ selected 1860 nudges and 1762 card updates: 36.22 simulated interventions per 100 cases. No real customer was contacted.

## Logistic vs Heuristic

- Simulated expected recovered-revenue difference: ₹73,017
- Simulated realized recovered-revenue difference: ₹72,118
- Action-selection disagreement: 14.82%
- Customer-intervention difference: -1460

## Policy Safety Analysis

- Hard-rule decisions: 4493 (44.93%)
- Model-ranked decisions: 5507 (55.07%)
- Raw model winners blocked by policy: 2969 (29.69%)
- Policy reasons: MODEL_SELECTED_BEST_ALLOWED_ACTION 5097, PAYMENT_METHOD_REQUIRES_UPDATE 1762, MANDATE_INVALID 969, ACTIVE_PAYMENT_DOWNTIME 559, NATIVE_RETRY_AVAILABLE 477, CUSTOMER_ACTION_HELPFUL 410, CASE_TOO_OLD 302, REPEATED_UNKNOWN_FAILURE 272, NATIVE_RETRIES_EXHAUSTED 152

## Per-Failure-Category Results

- BANK_OR_NETWORK: n=1964, expected 64.33%, realized 64.36%, dominant action WAIT_NATIVE_RETRY.
- CUSTOMER_AUTH_FAILURE: n=1491, expected 53.87%, realized 53.92%, dominant action WAIT_NATIVE_RETRY.
- MANDATE_OR_AUTH_INVALID: n=994, expected 14.97%, realized 14.69%, dominant action STOP_AND_ESCALATE.
- PAYMENT_METHOD_INVALID: n=1810, expected 66.05%, realized 67.29%, dominant action REQUEST_CARD_UPDATE.
- TEMPORARY_FUNDS: n=2500, expected 64.66%, realized 63.48%, dominant action WAIT_NATIVE_RETRY.
- UNKNOWN: n=1241, expected 38.48%, realized 39.32%, dominant action WAIT_NATIVE_RETRY.

## Limitations

This controlled simulator can compare policy behavior under published assumptions, but it cannot prove production merchant uplift, customer response, or causality. Hidden probabilities are synthetic ground truth, not observed Razorpay behavior.

## Reproducibility

Run `python ml/policy_evaluation/generate_policy_eval.py`, then `npm run evaluation:policy` in `server`. The model remains frozen; synthetic-policy-eval-v1 must never be used by train.py. Common random numbers ensure every strategy faces the same draw for each context.
