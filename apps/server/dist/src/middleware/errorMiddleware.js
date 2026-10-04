"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.errorConverter = void 0;
const zod_1 = require("zod");
const errors_api_1 = require("../errors/errors.api");
const errors_enum_1 = require("../errors/errors.enum");
const config_1 = require("../config");
// import { Prisma } from "../consolidate/prisma/generated/client";
const errorConverter = (err, req, res, next) => {
    let error = err;
    if (!(error instanceof errors_api_1.ApiError)) {
        if (error instanceof zod_1.z.ZodError) {
            const formattedErrors = error.issues.map(issue => {
                const fieldPath = issue.path.join(".");
                return `Field "${fieldPath}": ${issue.message}`;
            });
            console.error("\n⚠️ [VALIDATION_ERROR] Request failed schema validation:");
            formattedErrors.forEach(e => console.error(`   👉 ${e}`));
            const readableMessage = `Validation Error: ${formattedErrors.join("; ")}`;
            error = new errors_api_1.ApiError(errors_enum_1.HTTPStatusCode.BadRequest, readableMessage, error, true, error.stack);
        }
        else {
            const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
            const message = error.message || "Internal Server Error";
            error = new errors_api_1.ApiError(statusCode, message, error instanceof Error ? error : undefined, false, error.stack || undefined);
        }
    }
    next(error);
};
exports.errorConverter = errorConverter;
const errorHandler = (err, req, res, next) => {
    if (err instanceof zod_1.z.ZodError) {
        const formattedErrors = err.issues.map(issue => {
            const fieldPath = issue.path.join(".");
            return `Field "${fieldPath}": ${issue.message}`;
        });
        console.error("\n⚠️ [VALIDATION_ERROR] Request failed schema validation:");
        formattedErrors.forEach(e => console.error(`   👉 ${e}`));
        const readableMessage = `Validation Error: ${formattedErrors.join("; ")}`;
        err = new errors_api_1.ApiError(errors_enum_1.HTTPStatusCode.BadRequest, readableMessage, err, true, err.stack);
    }
    let { statusCode, message } = err;
    console.error(`💥 [API ERROR RESPONSE] HTTP ${statusCode || 500}: ${message}`);
    if (err.stack && config_1.env.NODE_ENV === "development") {
        console.error(`   Stack:`, err.stack);
    }
    const response = {
        code: statusCode || 500,
        message,
        error: message,
        ...(config_1.env.NODE_ENV === "development" && {
            stack: err.stack,
            cause: err.cause instanceof Error ? err.cause.message : err.cause,
            errors: err.errors || undefined,
        }),
    };
    res.status(statusCode || 500).json(response);
};
exports.errorHandler = errorHandler;
