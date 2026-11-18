/**
 * Theme UI shared by the session page and the compare page.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useUserLookup, type RecordData } from 'deepspace'
import { Button, useToast } from './ui'
import { TAG_META, TagChip } from './Tag'
import { callAction } from '../lib/actions'
import { cn } from '../lib/utils'
import { TAGS, type FeedbackData, type Tag, type ThemeData } from '../schemas/playtest-schemas'

export type NotesById = Map<string, RecordData<FeedbackData>>

/** The tag most of a theme's notes carry; decides its color. */
export function dominantTag(ids: string[], notes: NotesById): Tag {
  const counts = Object.fromEntries(TAGS.map((t) => [t, 0])) as Record<Tag, number>
  for (const id of ids) {
    const note = notes.get(id)
    if (note) counts[note.data.tag] += 1
  }
  return TAGS.reduce((best, t) => (counts[t] > counts[best] ? t : best), TAGS[0])
}

/** The notes behind a theme, so devs can check the AI's grouping. */
export function ThemeNotes({ ids, notes }: { ids: string[]; notes: NotesById }) {
  const { getName } = useUserLookup()
  const found = ids.map((id) => notes.get(id)).filter((n) => n !== undefined)
  if (found.length === 0) return <p className="text-xs text-muted-foreground">These notes were removed.</p>
  return (
    <ul className="space-y-2">
      {found.map((n) => (
        <li key={n.recordId} className="flex items-start gap-2 text-sm">
          <TagChip tag={n.data.tag} className="mt-0.5 shrink-0" />
          <span>
            {n.data.text}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{getName(n.data.testerId) ?? 'Tester'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Themes for one build, with the Summarize button. Shown on a session page;
 * themes cover every session of the build.
 */
export function ThemesPanel(props: {
  projectId: string
  buildId: string
  sessionId: string
  version: string
  sessionOpen: boolean
}) {
  const themes = useQuery<ThemeData>('themes', { where: { buildId: props.buildId }, orderBy: 'count', orderDir: 'desc' })
  const buildNotes = useQuery<FeedbackData>('feedback', { where: { buildId: props.buildId } })
  const [busy, setBusy] = useState(false)
  const { success, error } = useToast()

  const notes: NotesById = new Map(buildNotes.records.map((n) => [n.recordId, n]))
  const grouped = themes.records.reduce((sum, t) => sum + t.data.count, 0)
  const ungrouped = buildNotes.records.length - grouped
  const hasThemes = themes.records.length > 0

  async function summarize() {
    setBusy(true)
    try {
      const r = await callAction<{ themeCount: number; noteCount: number; matchedPrevious: number }>(
        'summarizeSession',
        { sessionId: props.sessionId },
      )
      success(
        `${r.noteCount} notes → ${r.themeCount} themes`,
        r.matchedPrevious > 0 ? `${r.matchedPrevious} match themes from the previous build.` : undefined,
      )
    } catch (err) {
      error('Could not summarize', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10 rounded border border-border bg-card p-5" aria-labelledby="themes-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="themes-heading" className="font-display text-xl font-bold">
            Themes for <span className="font-mono font-medium">{props.version}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.sessionOpen
              ? 'End the session to group its notes into themes with AI.'
              : hasThemes
                ? ungrouped > 0
                  ? `${ungrouped} ${ungrouped === 1 ? 'note has' : 'notes have'} arrived since these themes were made.`
                  : 'Grouped by AI from every note on this build. Open a theme to check its notes.'
                : 'Group every note on this build into named themes, then compare builds.'}
          </p>
        </div>
        {!props.sessionOpen && (
          <div className="flex items-center gap-2">
            {hasThemes && (
              <Link
                to={`/projects/${props.projectId}/compare?to=${props.buildId}`}
                className="text-sm font-medium underline underline-offset-4"
              >
                Compare builds
              </Link>
            )}
            <Button onClick={summarize} loading={busy} variant={hasThemes ? 'outline' : 'default'}>
              {busy ? 'Grouping notes…' : hasThemes ? 'Re-summarize' : 'Summarize with AI'}
            </Button>
          </div>
        )}
      </div>
      {busy && <p className="mt-2 font-mono text-xs text-muted-foreground">This usually takes 10–30 seconds.</p>}

      {hasThemes && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {themes.records.map((t) => {
            const tag = dominantTag(t.data.feedbackIds, notes)
            return (
              <li key={t.recordId}>
                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-start gap-3">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TAG_META[tag].dot)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{t.data.name}</span>
                      <span className="block text-sm text-muted-foreground">{t.data.summary}</span>
                    </span>
                    <span className="font-mono text-sm">{t.data.count}</span>
                    <span className="font-mono text-xs text-muted-foreground group-open:rotate-90" aria-hidden>
                      ›
                    </span>
                  </summary>
                  <div className="mt-3 pl-5">
                    <ThemeNotes ids={t.data.feedbackIds} notes={notes} />
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
