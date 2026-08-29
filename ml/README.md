# RecoveryIQ Stage 5B ML

RecoveryIQ's Stage 5B model is trained and evaluated on synthetic recovery episodes because production merchant subscription-failure histories are unavailable. The dataset generator and assumptions are published. Model metrics and recovery probabilities are simulation results and must not be interpreted as real-world merchant performance.

The offline pipeline is:

Synthetic dataset â†’ Logistic Regression training â†’ held-out evaluation â†’ exported model â†’ `LogisticRecoveryScorer`

Logistic Regression fits a binary outcome and small structured feature set, emits probabilities, trains quickly, exposes coefficients, and can be reproduced directly in Node. It is not claimed to be globally optimal.

## Run

```powershell
cd D:\RecoveryIQ\ml
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python generate_dataset.py
python train.py
python evaluate.py
```

Generation uses seed 42. Training uses a stratified 80/20 split. Evaluation reads only the untouched 20% test rows. The checked artifacts were generated with Python 3.13.7, NumPy 2.3.3, pandas 2.3.2, and scikit-learn 1.6.1.

## Outputs

- `data/synthetic_recovery_v1.csv`: 5,000 one-action synthetic episodes
- `artifacts/feature_schema_v1.json`: explicit encoding contract
- `artifacts/logistic_recovery_v1.json`: coefficients, intercept, scaler, categories, and metadata
- `artifacts/parity_v1.json`: Python probabilities for Node parity tests
- `reports/evaluation_v1.json` and `.md`: held-out metrics, calibration, per-action results, heuristic comparison, and limitations

`train.py` copies the portable model and parity fixture into the server source model directory. The server build copies them beside compiled JavaScript. The Node backend never launches Python and never loads pickle/joblib files.

RecoveryIQ separates prediction from decision-making. Logistic Regression estimates the probability of recovery for each candidate intervention. A later deterministic Policy Engine decides which actions are actually allowed. This prevents the ML model from directly controlling financial workflows.
