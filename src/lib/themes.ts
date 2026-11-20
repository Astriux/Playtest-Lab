/**
 * Pure theme logic, used by the server (cleaning AI output, merging themes)
 * and the browser (comparing builds). No I/O here, so it's all unit-tested
 * in themes.test.ts.
 */

export type RawTheme = { name: string; summary: string; noteIds: string[] }
export type CleanTheme = { name: string; summary: string; noteIds: string[] }

export const LEFTOVER_THEME = 'Other notes'

/** "  Wave 7  too HARD " and "wave 7 too hard" are the same theme. */
export function themeKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Tidy a theme name: single spaces, at most 80 characters. '' if empty. */
export function cleanThemeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80)
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
    const name = cleanThemeName(theme.name)
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

/**
 * Combine several themes into one, for a dev fixing the AI's grouping by
 * hand. Notes keep their order with no repeats; summaries are joined.
 */
export function mergeThemes(themes: { summary: string; feedbackIds: string[] }[]): { summary: string; feedbackIds: string[] } {
  const feedbackIds = [...new Set(themes.flatMap((t) => t.feedbackIds))]
  const summaries = [...new Set(themes.map((t) => t.summary.trim()).filter(Boolean))]
  return { summary: summaries.join(' ').slice(0, 300), feedbackIds }
}

export type Change = 'down' | 'up' | 'same' | 'new' | 'gone'

/** One theme on one build: how many notes, and how many different testers wrote them. */
export type ThemeTally<T> = { name: string; notes: number; testers: number; theme: T }
/** One build: its themes, and how many different testers left any note on it. */
export type BuildTally<T> = { testers: number; themes: ThemeTally<T>[] }
/** One side of a comparison row. `rate` is the share of the build's testers, 0 to 1. */
export type Side = { notes: number; testers: number; rate: number }

export type ComparisonRow<T> = {
  name: string
  before: Side
  after: Side
  change: Change
  beforeTheme?: T
  afterTheme?: T
}

/**
 * Moves smaller than this (10 percentage points of testers) count as "same".
 * With 4 testers one person is 25 points, so any real move still shows; with
 * 40 testers, one or two people changing their mind no longer looks like a fix.
 */
export const SAME_BAND = 0.1

/** Below this many testers, the compare page warns that percentages are shaky. */
export const FEW_TESTERS = 3

/**
 * Count notes and distinct testers per theme. One tester writing about the
 * same problem five times is one tester, not five.
 */
export function tallyThemes<T extends { name: string; feedbackIds: string[] }>(
  themes: T[],
  testerOf: Map<string, string>,
): ThemeTally<T>[] {
  return themes.map((theme) => {
    const testers = new Set(theme.feedbackIds.flatMap((id) => testerOf.get(id) ?? []))
    return { name: theme.name, notes: theme.feedbackIds.length, testers: testers.size, theme }
  })
}

function side(t: ThemeTally<unknown> | undefined, total: number): Side {
  if (!t) return { notes: 0, testers: 0, rate: 0 }
  return { notes: t.notes, testers: t.testers, rate: total > 0 ? t.testers / total : 0 }
}

/**
 * Line up two builds' themes by name and compare the SHARE of testers who
 * raised each one, not raw note counts. Otherwise a playtest with fewer
 * testers makes every problem look smaller, as if it were fixed.
 *
 * Matching by name works because the summarizer is told the previous build's
 * theme names and reuses them for the same issue (and devs can rename a theme
 * by hand). Biggest movers first, so "did my fix work?" is answered at the top.
 */
export function compareThemes<T>(before: BuildTally<T>, after: BuildTally<T>): ComparisonRow<T>[] {
  const pairs = new Map<string, { name: string; b?: ThemeTally<T>; a?: ThemeTally<T> }>()
  for (const t of before.themes) pairs.set(themeKey(t.name), { name: t.name, b: t })
  for (const t of after.themes) {
    const pair = pairs.get(themeKey(t.name))
    if (pair) Object.assign(pair, { name: t.name, a: t })
    else pairs.set(themeKey(t.name), { name: t.name, a: t })
  }

  const rows = [...pairs.values()].map(({ name, b, a }): ComparisonRow<T> => {
    const beforeSide = side(b, before.testers)
    const afterSide = side(a, after.testers)
    const diff = afterSide.rate - beforeSide.rate
    const change: Change = !b ? 'new' : !a ? 'gone' : Math.abs(diff) < SAME_BAND ? 'same' : diff < 0 ? 'down' : 'up'
    return { name, before: beforeSide, after: afterSide, change, beforeTheme: b?.theme, afterTheme: a?.theme }
  })

  const moved = (r: ComparisonRow<T>) => Math.abs(r.after.rate - r.before.rate)
  return rows.sort(
    (x, y) =>
      moved(y) - moved(x) ||
      Math.max(y.before.rate, y.after.rate) - Math.max(x.before.rate, x.after.rate) ||
      x.name.localeCompare(y.name),
  )
}

export function countChanges(rows: { change: Change }[]): Record<Change, number> {
  const counts: Record<Change, number> = { down: 0, up: 0, same: 0, new: 0, gone: 0 }
  for (const r of rows) counts[r.change] += 1
  return counts
}
