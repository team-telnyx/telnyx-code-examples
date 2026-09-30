/**
 * Application-level error taxonomy. Every upstream failure maps to a stable
 * code with an actionable, secret-free message for the browser.
 */
export type AppErrorCode =
  | "MISSING_TOKEN"
  | "INVALID_TOKEN"
  | "MISSING_SERVER_KEY"
  | "INVALID_INPUT"
  | "UNKNOWN_MODEL"
  | "NO_TELNYX_ROUTE"
  | "AUTH_FAILED"
  | "INSUFFICIENT_CREDITS"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_MISMATCH"
  | "MODEL_MISMATCH"
  | "MISSING_RECEIPT"
  | "VERIFICATION_FAILED"
  | "RATE_LIMITED"
  | "FORBIDDEN_ORIGIN"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: AppErrorCode,
    status: number,
    message: string,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function appErrorFromStatus(
  status: number,
  upstreamErrorType: string | null,
  truncatedUpstreamMessage: string | null,
  retryAfterSeconds: number | null
): AppError {
  switch (status) {
    case 400:
      return new AppError(
        "NO_TELNYX_ROUTE",
        502,
        truncatedUpstreamMessage ??
          "TrustedRouter found no Telnyx route satisfying the ZDR requirement for this model right now.",
        { cause: upstreamErrorType ?? undefined }
      );
    case 401:
    case 403:
      return new AppError(
        "AUTH_FAILED",
        502,
        "TrustedRouter rejected the server-side API key. Check TRUSTEDROUTER_API_KEY.",
        { cause: upstreamErrorType ?? undefined }
      );
    case 402:
      return new AppError(
        "INSUFFICIENT_CREDITS",
        502,
        "The TrustedRouter key has no credits left. Top up or use a key with a spend limit.",
        { cause: upstreamErrorType ?? undefined }
      );
    case 404:
      return new AppError(
        "UNKNOWN_MODEL",
        502,
        "TrustedRouter does not currently list a route for this model.",
        { cause: upstreamErrorType ?? undefined }
      );
    case 429:
      return new AppError(
        "UPSTREAM_RATE_LIMITED",
        502,
        "TrustedRouter rate limited the request. Retry after the indicated interval.",
        {
          ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
          cause: upstreamErrorType ?? undefined,
        }
      );
    default:
      if (status >= 500) {
        return new AppError(
          "UPSTREAM_ERROR",
          502,
          "TrustedRouter or the upstream provider failed to serve the request.",
          { cause: upstreamErrorType ?? undefined }
        );
      }
      return new AppError(
        "UPSTREAM_ERROR",
        502,
        truncatedUpstreamMessage ?? "TrustedRouter rejected the request.",
        { cause: upstreamErrorType ?? undefined }
      );
  }
}
