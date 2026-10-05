import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export type RequestWithId = Request & { requestId?: string };

export function requestId(req: RequestWithId, res: Response, next: NextFunction) {
  req.requestId = req.header("x-request-id")?.slice(0, 128) || randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (_req: Request, _res: Response, next: NextFunction) =>
  next(new HttpError(404, "NOT_FOUND", "Resource not found"));

function describeThrown(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const body = error as { message?: unknown; details?: unknown; hint?: unknown };
    return [body.message, body.details, body.hint]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" — ");
  }
  return String(error);
}

export const errorHandler: ErrorRequestHandler = (error, req: RequestWithId, res, _next) => {
  const validation = error instanceof ZodError;
  const databaseCode = typeof error?.code === "string" ? error.code : undefined;
  const status = validation
    ? 400
    : databaseCode === "23505"
      ? 409
      : databaseCode === "23503" || databaseCode === "23514"
        ? 400
        : typeof error?.status === "number"
          ? error.status
          : 500;
  const code = validation
    ? "VALIDATION_ERROR"
    : databaseCode === "23505"
      ? "ALREADY_EXISTS"
      : databaseCode === "23503"
        ? "INVALID_REFERENCE"
        : databaseCode === "23514"
          ? "INVALID_VALUE"
          : (error?.code ?? (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"));
  const message =
    status === 500
      ? "An unexpected error occurred"
      : validation
        ? "Invalid request"
        : databaseCode === "23505"
          ? "Resource already exists"
          : databaseCode === "23503"
            ? "Referenced resource does not exist"
            : databaseCode === "23514"
              ? "Invalid value"
              : String(error.message);
  if (status === 500)
    console.error(
      JSON.stringify({
        requestId: req.requestId,
        error: describeThrown(error) || "unknown",
      }),
    );
  res.status(status).json({ error: { code, message, requestId: req.requestId } });
};

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res, next).catch(next);
