# RecoveryIQ

RecoveryIQ is context-aware revenue recovery for failed recurring payments: **ML predicts. Policy controls. Razorpay confirms the outcome.**
## Problem

Recurring payments fail for different reasons, but naive recovery systems often retry or contact every customer the same way. That can create unnecessary customer friction, repeat impossible actions, and overstate what an ML score is allowed to decide.

## Solution

RecoveryIQ verifies Razorpay evidence, diagnoses the failure, estimates recovery probability for four bounded actions, applies deterministic financial policy, executes only the selected action, and records revenue only after authoritative payment evidence arrives.

```text
Razorpay failure -> verified webhook -> FailureEvent -> diagnosis
-> RecoveryContext -> scorer -> policy-v1 -> RecoveryDecision
-> bounded action -> authoritative outcome -> observed revenue metrics
```

## Core Architecture

- Failure evidence is normalized from verified, deduplicated Razorpay webhooks.
- `classifier-v1` produces deterministic categories and confidence.
- Razorpay downtime contributes external payment-method context.
- `heuristic-v1` and frozen `logistic-v1` score the same four candidate actions.
- `policy-v1` applies hard constraints before score ranking.
- Execution is idempotent and cannot override the selected decision.
- `subscription.charged` is the authoritative recovery signal.
- Outcome association remains distinct from causal uplift.

See [Architecture](docs/ARCHITECTURE.md) for the runtime, offline ML, and synthetic-evaluation paths.

## Razorpay Integration

RecoveryIQ uses Test Mode subscriptions, Standard Checkout for customer-driven card changes, and raw-body HMAC webhook verification. Relevant events include `payment.failed`, `subscription.pending`, `subscription.halted`, `subscription.charged`, `subscription.activated`, and `subscription.cancelled`.

`WAIT_NATIVE_RETRY` never calls a payment API or schedules a retry. It records that Razorpay owns the native retry process.

## Machine Learning

Logistic Regression estimates:

```text
P(recovery within 7 days | recovery context, candidate action)
```

It fits this product because the inputs are structured, output probabilities are useful for ranking, coefficients remain interpretable, the artifact is portable JSON, and inference is small and fast. The model is trained on published synthetic episodes because production merchant histories were unavailable. It is not described as advanced AI or as proof of merchant uplift.

## Policy Safety Layer

The model does not control the financial workflow. `policy-v1` blocks or selects actions using terminal status, case age, mandate validity, payment-method validity, downtime, native retry feasibility, nudge limits, cooldown, and repeated unknown-failure rules. Only allowed actions can be ranked by a scorer.

In the Stage 9 controlled simulation, deterministic policy blocked the raw ML winner in **29.69%** of contexts.

## Recovery Actions

- `WAIT_NATIVE_RETRY`: records a no-op toward Razorpay; no payment attempt is initiated.
- `SEND_NUDGE`: deterministic template through a provider abstraction; local mode is simulation and contacts nobody.
- `REQUEST_CARD_UPDATE`: creates a short-lived customer session, stores only a token hash, and verifies Checkout server-side.
- `STOP_AND_ESCALATE`: marks merchant review required without a payment or notification call.

## Outcome Tracking

An action is not considered successful merely because it was selected or executed. Recovery revenue is recorded only from authoritative successful-payment evidence. Exact invoice correlation is preferred; a conservative subscription-only fallback is allowed only for one recent plausible case.

Observed recovery describes financial truth. Action association describes sequence. Neither alone proves causal uplift.

## Synthetic Evaluation

Stage 9 froze `logistic-v1`, generated 10,000 fresh unseen contexts with seed 4242, invoked the production TypeScript scorer and policy, and compared them with Heuristic + Policy, Retry First, and Nudge First under the same hidden probabilities and shared random draw.

## Results

On `synthetic-policy-eval-v1`, RecoveryIQ achieved **22.24% higher simulated expected recovered revenue than Retry First** and **20.95% higher than Nudge First**. It selected 3,622 customer interventions, compared with 5,082 for Heuristic + Policy and 7,515 for Nudge First.

**These are controlled simulation results, not production merchant uplift.** The real Razorpay integration validates operational data flow; Stage 9 evaluates policy behavior only under published synthetic assumptions.

## Tech Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS
- Node.js, Express, TypeScript
- MongoDB Atlas / Mongoose
- Razorpay Test Mode
- Python, NumPy, pandas, scikit-learn for offline model work
- Vitest, Supertest, MongoDB Memory Server

## Local Setup

Prerequisites: Node.js 22+, npm, Python 3.11+, MongoDB, and Razorpay Test Mode credentials.

```powershell
Copy-Item .env.example server/.env
Copy-Item client/.env.example client/.env.local

cd server
npm install
npm run dev

cd ..\client
npm install
npm run dev
```

Set only public backend configuration in the client environment. Never use `NEXT_PUBLIC_` for Razorpay secrets, webhook secrets, MongoDB credentials, or notification provider keys.

Useful checks:

```powershell
cd server
npm run demo:status
npm run typecheck
npm test

cd ..\client
npm run lint
npm run build
```

## Deployment

Recommended layout: Vercel or an equivalent Next.js host for the frontend, a persistent Node.js host for Express, MongoDB Atlas, and Razorpay Test Mode. A temporary zrok/ngrok URL is local-development infrastructure, not a permanent backend.

See [Deployment Guide](docs/DEPLOYMENT.md) for environment variables, commands, CORS, webhook configuration, and post-deploy checks.

## Demo Flow

The 4 to 5 minute judge flow and connectivity fallback are documented in [Demo Guide](docs/DEMO.md). Concise pitch variants and judge answers are in [Pitch Guide](docs/PITCH.md).

## Limitations

- The trained model and policy evaluation use synthetic assumptions.
- Stage 9 demonstrates simulated policy behavior, not causal production uplift.
- Notification delivery is simulation-only in the validated configuration.
- The final ₹699 Test Mode success remains a human Razorpay Dashboard validation step until manually performed.
- RecoveryIQ does not schedule native retries or infer who initiated a successful charge.

## Security

- Raw-body webhook HMAC verification and event-level idempotency
- Timing-safe signature comparison for card-update completion
- Payment-level outcome idempotency and one finalized outcome per case
- Razorpay and MongoDB secrets remain server-side
- Card data, CVV, VPA, raw webhook payloads, and raw recovery tokens are not persisted
- Recovery tokens are random, hashed, short-lived, and single-purpose
- Decision fingerprints, action idempotency, and stale-decision protection bound execution

RecoveryIQ does not claim PCI certification.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Demo](docs/DEMO.md)
- [Pitch and judge questions](docs/PITCH.md)
- [ML pipeline](ml/README.md)
