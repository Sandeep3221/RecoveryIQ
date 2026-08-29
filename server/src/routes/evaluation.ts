import { Router } from "express";
import { latestEvaluation } from "../controllers/evaluationController.js";

export const evaluationRouter = Router();
evaluationRouter.get("/latest", latestEvaluation);
