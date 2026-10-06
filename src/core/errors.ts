import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = {},
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const details = Object.fromEntries(err.issues.map((i) => [i.path.join("."), i.message]));
    res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "Invalid input", details } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Malformed JSON bodies from express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "Malformed JSON", details: {} } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong", details: {} } });
};
