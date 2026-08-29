import { Router } from "express";
import { getCardUpdateSession, verifyCardUpdate } from "../controllers/cardUpdateRecoveryController.js";

export const recoveryCardUpdateRouter = Router();
recoveryCardUpdateRouter.get("/:token", getCardUpdateSession);
recoveryCardUpdateRouter.post("/verify", verifyCardUpdate);
