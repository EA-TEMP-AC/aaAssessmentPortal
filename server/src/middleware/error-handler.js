import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  if (err?.type === "entity.parse.failed") {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Malformed JSON" },
    });
    return;
  }

  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL", message: "Internal server error" },
  });
}
