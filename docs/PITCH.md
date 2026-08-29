# RecoveryIQ Pitch Guide

## 15-second pitch

RecoveryIQ helps subscription businesses respond intelligently to failed recurring payments. It predicts which intervention may recover revenue, uses deterministic policy to block unsafe choices, executes only bounded actions, and counts recovery only when Razorpay confirms payment.

## 30-second pitch

Recurring payment failures are not all the same, but recovery systems often treat them identically. RecoveryIQ combines verified Razorpay evidence, deterministic diagnosis, payment downtime, and Logistic Regression to estimate recovery probability for four possible actions. A hard policy layer decides what is operationally appropriate, an idempotent executor performs only that decision, and authoritative webhooks confirm outcomes. ML predicts. Policy controls. Razorpay confirms the outcome.

## 90-second explanation

Razorpay webhooks enter through raw-body HMAC verification and event deduplication. RecoveryIQ creates safe failure evidence, assigns a deterministic failure category, and builds a RecoveryContext with subscription state, customer history, retry feasibility, and downtime.

The frozen Logistic Regression model estimates recovery within seven days for WAIT, nudge, card update, and stop. Those probabilities are advisory. `policy-v1` runs first-order safety and merchant rules, blocks inappropriate actions, and lets the model rank only what remains. The executor cannot change the decision and uses stable identities to prevent duplicates.

RecoveryIQ records recovered revenue only after authoritative captured-payment evidence from `subscription.charged`. It distinguishes observed recovery, temporal action association, and causal uplift. Because one Test Mode subscription cannot prove uplift, Stage 9 evaluates the production scorer and policy on 10,000 fresh synthetic contexts against transparent baselines under common random outcomes. The results are useful simulated policy evidence, not a production revenue claim.

## Judge-friendly architecture story

1. Razorpay tells us what failed.
2. RecoveryIQ determines the failure context.
3. ML predicts recovery likelihood for possible interventions.
4. Deterministic policy removes unsafe or inappropriate actions.
5. The executor performs only the approved bounded action.
6. Razorpay webhooks confirm whether money actually recovered.
7. Synthetic evaluation compares decision strategies without pretending test data is merchant production data.

## Likely judge questions

### Why Logistic Regression?

The data is structured, we need calibrated probability-like outputs per action, coefficients are inspectable, the model is portable as small JSON, and Node inference is fast. A larger model would add complexity without better evidence.

### Why synthetic data?

We did not have a merchant-scale history of subscription failures and outcomes. We publish the assumptions, freeze the model before evaluation, and label every result synthetic instead of claiming unsupported real-world performance.

### Why not let AI execute payments?

Predicted success does not imply an action is allowed or appropriate. Deterministic policy controls the financial workflow, and execution is restricted to the persisted policy decision.

### How do you know the model helps?

In `synthetic-policy-eval-v1`, the production logistic scorer plus policy outperformed naive strategies and the heuristic under the same 10,000 contexts and shared random outcomes. This validates behavior inside the simulator, not production uplift.

### Why Razorpay?

It provides subscription lifecycle webhooks, payment evidence, Test Mode, Checkout, and the authoritative state needed to keep detection and outcomes grounded in a real payment system.

### How do you prevent duplicate actions?

Decisions have stable identities, action creation is idempotent per decision, webhook events are deduplicated, and successful payment IDs cannot be counted twice.

### Does WAIT_NATIVE_RETRY trigger a charge?

No. It makes zero payment API calls and schedules nothing. It records that RecoveryIQ is deferring intervention while Razorpay owns any native retry behavior.

### Are the uplift numbers real?

They are real outputs of a controlled synthetic simulator, but they are not real merchant uplift. We always display the word simulated and keep those results separate from live Razorpay observations.

### How is card information handled?

RecoveryIQ never stores card numbers, CVV, VPA, or raw payment credentials. It creates a short-lived token session, stores only the token hash, and delegates card change to Razorpay Checkout.

### What happens when ML is wrong?

Policy still constrains the choice, every decision remains explainable and traceable, execution is bounded, and only authoritative payment evidence counts as recovery. A new failure requires the explicit diagnose, score, decide, execute pipeline again.
