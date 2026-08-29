# RecoveryIQ Deployment Guide

## Recommended layout

| Component | Recommended host | Requirement |
|---|---|---|
| Next.js frontend | Vercel or equivalent | Public HTTPS URL |
| Express backend | Persistent Node.js host | Stable HTTPS URL and Node.js 22+ |
| Database | MongoDB Atlas | Network access from backend |
| Payments | Razorpay Test Mode | Test keys and verified webhook secret |

A temporary zrok or ngrok tunnel is suitable for local development only. The final hackathon demo should preferably use a deployed backend so webhook delivery remains stable.

## Server environment

Required:

```dotenv
PORT=4000
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>
NODE_ENV=production
CLIENT_URL=https://<deployed-frontend>
RAZORPAY_KEY_ID=rzp_test_<id>
RAZORPAY_KEY_SECRET=<server-secret>
RAZORPAY_WEBHOOK_SECRET=<server-secret>
RECOVERY_SCORER=logistic
RECOVERY_NOTIFICATION_MODE=simulation
```

Do not expose these values to the browser. Live notification configuration is optional future infrastructure; the validated Stage 10 configuration remains simulation-only.

## Client environment

```dotenv
NEXT_PUBLIC_API_URL=https://<deployed-backend>
```

Only the public backend origin belongs in a `NEXT_PUBLIC_` variable.

## Build and start

Backend:

```powershell
cd server
npm ci
npm run typecheck
npm run build
npm start
```

Frontend:

```powershell
cd client
npm ci
npm run lint
npm run build
npm start
```

The backend host should run `npm start` as a persistent web service. It does not require Redis, queues, workers, Docker, or a payment-retry scheduler.

## CORS and webhook configuration

Set `CLIENT_URL` to the exact deployed frontend origin. In Razorpay Test Mode configure:

```text
https://<DEPLOYED-BACKEND>/api/webhooks/razorpay
```

Subscribe to the events used by RecoveryIQ:

- `payment.failed`
- `subscription.pending`
- `subscription.halted`
- `subscription.charged`
- `subscription.activated`
- `subscription.cancelled`

Copy the webhook secret into `RAZORPAY_WEBHOOK_SECRET`. Do not weaken the existing raw-body verification route.

## Post-deploy validation

1. Request `GET /health/live`; expect `status: ok`.
2. Request `GET /health/ready`; confirm database, scorer artifact, scorer mode, notification mode, and safe Razorpay configuration status.
3. Run `npm run demo:status`; confirm case and evaluation summary counts without secret values.
4. Load `/`, `/subscriptions`, `/recovery-cases`, a case detail, and `/evaluation`.
5. Verify CORS from the deployed frontend.
6. Send a Razorpay Test Mode webhook and confirm signature verification and deduplication.
7. Verify an invalid `/recover/card/<token>` request is rejected cleanly.

## Rollback and data safety

Deploy application code without deleting MongoDB collections. There is intentionally no destructive demo-reset command. Preserve the real ₹699 case and the persisted Stage 9 EvaluationRun. Credential rotation is performed in the host and Razorpay Dashboard, never by an application script.
