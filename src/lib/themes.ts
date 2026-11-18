/**
 * Pure theme logic, used by the server (cleaning AI output) and the browser
 * (comparing builds). No I/O here, so it's all unit-tested in themes.test.ts.
 */

export type RawTheme = { name: string; summary: string; noteIds: string[] }
export type CleanTheme = { name: string; summary: string; noteIds: string[] }

export const LEFTOVER_THEME = 'Other notes'

/** "  Wave 7  too HARD " and "wave 7 too hard" are the same theme. */
export function themeKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Turn whatever the model returned into themes we can trust:
 * - ids the model invented are dropped,
 * - each note lands in exactly one theme (first mention wins),
 * - themes with the same name (ignoring case/spaces) are merged,
 * - notes the model skipped go into "Other notes",
 * - empty themes disappear, and names/summaries are length-capped.
 * Counts are never taken from the model; they're the number of notes.
 */
export function cleanThemes(raw: RawTheme[], validIds: string[]): CleanTheme[] {
  const valid = new Set(validIds)
  const used = new Set<string>()
  const byKey = new Map<string, CleanTheme>()

  for (const theme of raw) {
    const name = theme.name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!name) continue
    const ids = theme.noteIds.filter((id) => valid.has(id) && !used.has(id))
    ids.forEach((id) => used.add(id))
    const existing = byKey.get(themeKey(name))
    if (existing) existing.noteIds.push(...ids)
    else byKey.set(themeKey(name), { name, summary: theme.summary.trim().slice(0, 300), noteIds: ids })
  }

  const leftovers = validIds.filter((id) => !used.has(id))
  if (leftovers.length > 0) {
    const other = byKey.get(themeKey(LEFTOVER_THEME))
    if (other) other.noteIds.push(...leftovers)
    else byKey.set(themeKey(LEFTOVER_THEME), { name: LEFTOVER_THEME, summary: 'Notes that did not fit another theme.', noteIds: leftovers })
  }

  return [...byKey.values()].filter((t) => t.noteIds.length > 0).sort((a, b) => b.noteIds.length - a.noteIds.length)
}

export type Change = 'down' | 'up' | 'same' | 'new' | 'gone'
export type ComparisonRow<T> = {
  name: string
  before: number
  after: number
  change: Change
  beforeTheme?: T
  afterTheme?: T
}

/**
 * Line up two builds' themes by name. This only works because the summarizer
 * is told the previous build's theme names and reuses them for the same issue.
 * Biggest movers first, so "did my fix work?" is answered at the top.
 */
export function compareThemes<T extends { name: string; count: number }>(
  before: T[],
  after: T[],
): ComparisonRow<T>[] {
  const rows = new Map<string, ComparisonRow<T>>()
  for (const t of before) {
    rows.set(themeKey(t.name), { name: t.name, before: t.count, after: 0, change: 'gone', beforeTheme: t })
  }
  for (const t of after) {
    const row = rows.get(themeKey(t.name))
    if (row) Object.assign(row, { name: t.name, after: t.count, afterTheme: t })
    else rows.set(themeKey(t.name), { name: t.name, before: 0, after: t.count, change: 'new', afterTheme: t })
  }
  for (const row of rows.values()) {
    if (row.before === 0) row.change = 'new'
    else if (row.after === 0) row.change = 'gone'
    else row.change = row.after < row.before ? 'down' : row.after > row.before ? 'up' : 'same'
  }
  return [...rows.values()].sort(
    (a, b) =>
      Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
      Math.max(b.before, b.after) - Math.max(a.before, a.after) ||
      a.name.localeCompare(b.name),
  )
}

export function countChanges(rows: { change: Change }[]): Record<Change, number> {
  const counts: Record<Change, number> = { down: 0, up: 0, same: 0, new: 0, gone: 0 }
  for (const r of rows) counts[r.change] += 1
  return counts
}
