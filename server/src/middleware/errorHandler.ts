import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../utils/AppError.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error("Unhandled request error", error instanceof Error ? { name: error.name, message: error.message } : { message: "Unknown error" });
  res.status(500).json({ error: "Unexpected server error" });
};
