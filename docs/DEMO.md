# RecoveryIQ Demo Guide

Target duration: 4 to 5 minutes.

## Before judging

1. Start the backend and frontend.
2. Check `GET /health/ready` and run `npm run demo:status` from `server`.
3. Confirm `/evaluation` loads the persisted 10,000-context EvaluationRun.
4. If running locally, start zrok and update the Razorpay Test Mode webhook URL. For a deployed demo, use the stable backend URL instead.
5. Keep the existing CloudDesk Pro recovery case open in a browser tab.

## Demo sequence

### 1. Problem, 20 seconds

“Recurring payments fail for different reasons, but naive systems often retry or contact every customer the same way. RecoveryIQ uses evidence and context to choose a bounded response.”

### 2. Architecture, 25 seconds

“Razorpay tells us what failed. RecoveryIQ diagnoses it, predicts recovery probability for each candidate action, constrains those choices with deterministic policy, executes only the approved action, and waits for Razorpay to confirm the financial outcome.”

Key line: **ML predicts. Policy controls. Razorpay confirms the outcome.**

### 3. Real case, 75 seconds

Open the existing CloudDesk Pro ₹699 case.

- Show verified failed-payment evidence and the deterministic `UNKNOWN` diagnosis.
- Show card payment method, pending subscription, native retry availability, and confirmed downtime.
- Show all four `logistic-v1` probabilities. Do not call the largest prediction a decision.
- Show `policy-v1` selected `WAIT_NATIVE_RETRY` through `ACTIVE_PAYMENT_DOWNTIME`.
- Point out that the hard rule controls even if another model score were larger.

### 4. Bounded execution, 30 seconds

Show the executed WAIT action.

“RecoveryIQ made no payment attempt, scheduled no custom retry, and contacted no customer. Razorpay owns the native retry process.”

### 5. Optional real Test Mode outcome, 45 seconds

This step requires a human Razorpay Dashboard action:

1. Open the existing CloudDesk Pro Test Mode subscription.
2. Use Razorpay Dashboard’s test-mode charge simulation.
3. Produce one successful subscription charge.
4. Observe `subscription.charged` in webhook delivery.
5. Refresh the RecoveryIQ case.

Expected safely correlated state:

- `ACTION_EXECUTED` becomes `RECOVERED`
- observed recovered revenue is capped at ₹699
- the decision remains `WAIT_NATIVE_RETRY`
- action count remains one
- RecoveryIQ-created payment mutations remain zero

Say: “RecoveryIQ observed an authoritative ₹699 successful Razorpay charge after its WAIT decision. The test-mode success was manually triggered to validate the outcome pipeline; it does not prove that RecoveryIQ caused the payment.”

Never say that RecoveryIQ automatically recovered ₹699 or that Razorpay native retry initiated the manually simulated success.

### 6. Synthetic policy evaluation, 60 seconds

Open `/evaluation`.

- Explain 10,000 fresh contexts, frozen `logistic-v1`, production TypeScript scorer and policy, and shared random outcomes.
- Show 22.24% higher simulated expected recovered revenue than Retry First.
- Show 20.95% higher simulated expected recovered revenue than Nudge First.
- Compare 3,622 RecoveryIQ customer interventions with 5,082 heuristic and 7,515 Nudge First interventions.
- Show 29.69% of raw ML winners were blocked by policy.

Immediately qualify: “These are controlled synthetic simulation results, not production merchant uplift.”

### 7. Close, 20 seconds

“RecoveryIQ is not an AI that charges cards. It is an evidence, prediction, policy, execution, and measurement pipeline that keeps financial control deterministic.”

## Connectivity fallback

If Razorpay webhook connectivity fails during judging, do not fabricate a webhook or create another case.

Use the already persisted ₹699 case to demonstrate failure evidence, diagnosis, ML probabilities, policy selection, and WAIT execution. Then show the persisted Stage 9 EvaluationRun.

Say: “The real Razorpay flow was previously validated; this persisted case demonstrates the resulting state. We are not simulating a new live payment during this fallback.”
