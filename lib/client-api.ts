"use client";

import type { ApiErrorBody } from "@/lib/types";

/** Error thrown by `fetchApi`, carrying the route handler's structured payload. */
export class ApiError extends Error {
  readonly kind: ApiErrorBody["kind"];
  readonly retryAfterSeconds?: number;

  constructor(body: ApiErrorBody) {
    super(body.error);
    this.name = "ApiError";
    this.kind = body.kind;
    this.retryAfterSeconds = body.retryAfterSeconds;
  }
}

/**
 * Calls one of this app's own route handlers. All Reddit traffic happens behind
 * those handlers, so the browser only ever talks to `/api/*`.
 */
export async function fetchApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, cache: "no-store" });

  if (!response.ok) {
    let body: ApiErrorBody = { error: `Request failed (${response.status}).`, kind: "unknown" };
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error body (e.g. a platform-level 502); keep the generic message.
    }
    throw new ApiError(body);
  }

  return (await response.json()) as T;
}
