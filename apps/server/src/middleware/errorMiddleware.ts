import { ErrorRequestHandler } from "express";

import { z } from "zod";

import { ApiError } from "../errors/errors.api";
import { HTTPStatusCode } from "../errors/errors.enum";
import { env } from "../config";
// import { Prisma } from "../consolidate/prisma/generated/client";

export const errorConverter: ErrorRequestHandler = (err, req, res, next) => {
  let error = err;
  if (!(error instanceof ApiError)) {
    if (error instanceof z.ZodError) {
      const formattedErrors = error.issues.map(issue => {
        const fieldPath = issue.path.join(".");
        return `Field "${fieldPath}": ${issue.message}`;
      });
      console.error("\n⚠️ [VALIDATION_ERROR] Request failed schema validation:");
      formattedErrors.forEach(e => console.error(`   👉 ${e}`));
      const readableMessage = `Validation Error: ${formattedErrors.join("; ")}`;
      error = new ApiError(HTTPStatusCode.BadRequest, readableMessage, error, true, error.stack);
    } else {
      const statusCode =
        typeof error.statusCode === "number" ? error.statusCode : 500;
      const message = error.message || "Internal Server Error";

      error = new ApiError(
        statusCode,
        message,
        error instanceof Error ? error : undefined,
        false,
        error.stack || undefined
      );
    }
  }

  next(error);
};



export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof z.ZodError) {
    const formattedErrors = err.issues.map(issue => {
      const fieldPath = issue.path.join(".");
      return `Field "${fieldPath}": ${issue.message}`;
    });
    console.error("\n⚠️ [VALIDATION_ERROR] Request failed schema validation:");
    formattedErrors.forEach(e => console.error(`   👉 ${e}`));
    const readableMessage = `Validation Error: ${formattedErrors.join("; ")}`;
    err = new ApiError(HTTPStatusCode.BadRequest, readableMessage, err, true, err.stack);
  }

  let { statusCode, message } = err;

  console.error(`💥 [API ERROR RESPONSE] HTTP ${statusCode || 500}: ${message}`);
  if (err.stack && env.NODE_ENV === "development") {
    console.error(`   Stack:`, err.stack);
  }

  const response = {
    code: statusCode || 500,
    message,
    error: message,
    ...(env.NODE_ENV === "development" && {
      stack: err.stack,
      cause: err.cause instanceof Error ? err.cause.message : err.cause,
      errors: err.errors || undefined,
    }),
  };

  res.status(statusCode || 500).json(response);
};

