import { Router } from "express";
import { receiveRazorpayWebhook } from "../controllers/razorpayWebhookController.js";

export const razorpayWebhooksRouter = Router();
razorpayWebhooksRouter.post("/", receiveRazorpayWebhook);
