/** Presentation helpers. Safe to import from client components (no secrets, no I/O). */

export function formatScore(score: number): string {
  if (Math.abs(score) >= 10_000) return `${(score / 1000).toFixed(1)}k`;
  return score.toLocaleString("en-US");
}

/** "3h ago" / "just now" — computed from a Reddit `created_utc` value (seconds). */
export function formatAge(createdUtc: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - createdUtc));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
