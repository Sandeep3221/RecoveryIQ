import { Router } from "express";
import { decideCase, diagnoseCase, executeCase, getRecoveryCase, listRecoveryCases, scoreCase } from "../controllers/recoveryCaseController.js";

export const recoveryCasesRouter = Router();
recoveryCasesRouter.get("/", listRecoveryCases);
recoveryCasesRouter.post("/:id/diagnose", diagnoseCase);
recoveryCasesRouter.post("/:id/score", scoreCase);
recoveryCasesRouter.post("/:id/decide", decideCase);
recoveryCasesRouter.post("/:id/execute", executeCase);
recoveryCasesRouter.get("/:id", getRecoveryCase);
