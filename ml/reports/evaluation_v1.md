# RecoveryIQ Stage 5B Evaluation

RecoveryIQ's Stage 5B model is trained and evaluated on synthetic recovery episodes because production merchant subscription-failure histories are unavailable. The dataset generator and assumptions are published. Model metrics and recovery probabilities are simulation results and must not be interpreted as real-world merchant performance.

## Dataset

- Episodes: 5000
- Train/test: 4000/1000
- Positive outcome rate: 42.80%
- Features after encoding: 76

## Held-out metrics

| Accuracy | Precision | Recall | F1 | ROC-AUC | Log Loss | Brier Score |
|---:|---:|---:|---:|---:|---:|---:|
| 0.6800 | 0.6667 | 0.5047 | 0.5745 | 0.7355 | 0.5924 | 0.2038 |

Brier Score is included because RecoveryIQ needs probability quality, not only binary classification accuracy.

## Per-action metrics

| Action | Samples | Actual rate | Mean prediction | Brier |
|---|---:|---:|---:|---:|
| WAIT_NATIVE_RETRY | 316 | 0.5411 | 0.5268 | 0.2096 |
| SEND_NUDGE | 256 | 0.3867 | 0.4459 | 0.2033 |
| REQUEST_CARD_UPDATE | 242 | 0.4752 | 0.4056 | 0.2233 |
| STOP_AND_ESCALATE | 186 | 0.2312 | 0.2387 | 0.1694 |

## Heuristic vs Logistic

Both scorers were evaluated on the identical held-out rows and observed candidate actions.

| Scorer | Brier | Log Loss | ROC-AUC |
|---|---:|---:|---:|
| logistic-v1 | 0.2038 | 0.5924 | 0.7355 |
| heuristic-v1 | 0.2423 | 0.7474 | 0.6598 |

## Calibration

| Bucket | Samples | Mean prediction | Actual rate |
|---|---:|---:|---:|
| 0.0-0.1 | 27 | 0.0708 | 0.1111 |
| 0.1-0.2 | 124 | 0.1587 | 0.0887 |
| 0.2-0.3 | 186 | 0.2541 | 0.3226 |
| 0.3-0.4 | 207 | 0.3478 | 0.3865 |
| 0.4-0.5 | 132 | 0.4535 | 0.4394 |
| 0.5-0.6 | 107 | 0.5466 | 0.5140 |
| 0.6-0.7 | 66 | 0.6441 | 0.6818 |
| 0.7-0.8 | 70 | 0.7497 | 0.7000 |
| 0.8-0.9 | 70 | 0.8404 | 0.8143 |
| 0.9-1.0 | 11 | 0.9244 | 0.9091 |

## Limitations

- All episodes and outcomes are synthetic simulation data.
- No merchant production outcomes or causal treatment effects were used.
- Per-action estimates are predictive simulation results, not permitted-action decisions or revenue uplift.
