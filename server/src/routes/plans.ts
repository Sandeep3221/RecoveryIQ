import { Router } from "express";
import { listPlans } from "../controllers/planController.js";
export const plansRouter = Router();
plansRouter.get("/", listPlans);
