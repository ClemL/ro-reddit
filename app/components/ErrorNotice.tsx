"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/client-api";

type Props = {
  error: unknown;
  onRetry?: () => void;
};

/**
 * Renders any failure without taking the page down. A rate-limit error counts
 * down to the reset instead of showing a static message.
 */
export default function ErrorNotice({ error, onRetry }: Props) {
  const rateLimited = error instanceof ApiError && error.kind === "rate_limited";
  const initialWait = rateLimited ? (error.retryAfterSeconds ?? 60) : 0;
  const [secondsLeft, setSecondsLeft] = useState(initialWait);

  useEffect(() => {
    setSecondsLeft(initialWait);
    if (initialWait <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [initialWait, error]);

  if (rateLimited) {
    return (
      <p className="notice warn">
        {secondsLeft > 0
          ? `Rate limited, try again in ${secondsLeft}s.`
          : "Rate limit window has reset."}{" "}
        {onRetry ? (
          <button type="button" onClick={onRetry} disabled={secondsLeft > 0}>
            Retry
          </button>
        ) : null}
      </p>
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  const isConfig = error instanceof ApiError && error.kind === "config";

  return (
    <p className="notice error">
      {message}
      {isConfig ? " Set them in .env.local locally, or in Vercel project settings." : ""}{" "}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </p>
  );
}
