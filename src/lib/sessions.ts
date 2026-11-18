/** Sessions end on their own this long after they open. */
export const SESSION_MAX_HOURS = 24

/** Ids of sessions that have been open longer than the limit. */
export function staleSessionIds(
  sessions: { recordId: string; createdAt: string }[],
  now: number,
  maxHours = SESSION_MAX_HOURS,
): string[] {
  const cutoff = now - maxHours * 60 * 60 * 1000
  return sessions.filter((s) => Date.parse(s.createdAt) < cutoff).map((s) => s.recordId)
}

/** Hours left before an open session ends on its own (never below 0). */
export function hoursLeft(createdAt: string, now: number, maxHours = SESSION_MAX_HOURS): number {
  const endsAt = Date.parse(createdAt) + maxHours * 60 * 60 * 1000
  return Math.max(0, Math.ceil((endsAt - now) / (60 * 60 * 1000)))
}
