import { Router } from "express";
import { createSubscription, getSubscription, listSubscriptions, syncSubscription, verifyAuthorization } from "../controllers/subscriptionController.js";
export const subscriptionsRouter = Router();
subscriptionsRouter.post("/verify-authorization", verifyAuthorization);
subscriptionsRouter.get("/", listSubscriptions);
subscriptionsRouter.post("/", createSubscription);
subscriptionsRouter.get("/:id", getSubscription);
subscriptionsRouter.post("/:id/sync", syncSubscription);
