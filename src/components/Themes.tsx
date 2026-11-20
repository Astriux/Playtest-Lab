/**
 * Theme UI shared by the session page and the compare page.
 */

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { Button, Input, Label, useToast } from './ui'
import { ClipLink } from './ClipLink'
import { TAG_META, TagChip } from './Tag'
import { callAction } from '../lib/actions'
import { testerLabel } from '../lib/format'
import { cn } from '../lib/utils'
import { TAGS, type FeedbackData, type SummarizeLockData, type Tag, type ThemeData } from '../schemas/playtest-schemas'

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
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {testerLabel(getName(n.data.testerId), n.data.testerId)}
            </span>
            {n.data.clipUrl && (
              <span className="ml-2">
                <ClipLink url={n.data.clipUrl} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A summarize lock older than this is ignored (same rule as the server). */
const LOCK_STALE_MS = 5 * 60 * 1000

/**
 * Themes for one build, with the Summarize button and hand editing. Shown on
 * a session page; themes cover every session of the build.
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
  const locks = useQuery<SummarizeLockData>('summarize_locks', { where: { buildId: props.buildId } })
  const projectThemes = useQuery<ThemeData>('themes', { where: { projectId: props.projectId } })
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const { success, error } = useToast()

  const notes: NotesById = new Map(buildNotes.records.map((n) => [n.recordId, n]))
  const grouped = themes.records.reduce((sum, t) => sum + t.data.count, 0)
  const ungrouped = buildNotes.records.length - grouped
  const hasThemes = themes.records.length > 0

  // Someone (maybe a teammate) is summarizing this build right now.
  const lock = locks.records.find((l) => Date.now() - Date.parse(l.createdAt) < LOCK_STALE_MS)
  const lockedBy = lock && (lock.data.userId === userId ? 'You are' : `${getName(lock.data.userId) ?? 'A teammate'} is`)

  // Theme names from the project's other builds, offered while renaming.
  const otherNames = [
    ...new Set(projectThemes.records.filter((t) => t.data.buildId !== props.buildId).map((t) => t.data.name)),
  ]

  async function summarize() {
    setBusy(true)
    try {
      const r = await callAction<{ themeCount: number; noteCount: number; matchedPrevious: number }>(
        'summarizeSession',
        { sessionId: props.sessionId },
      )
      setEditing(false)
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
          <div className="flex flex-wrap items-center gap-2">
            {hasThemes && !editing && (
              <Link
                to={`/projects/${props.projectId}/compare?to=${props.buildId}`}
                className="text-sm font-medium underline underline-offset-4"
              >
                Compare builds
              </Link>
            )}
            {hasThemes && (
              <Button variant="ghost" onClick={() => setEditing(!editing)}>
                {editing ? 'Done editing' : 'Edit themes'}
              </Button>
            )}
            <Button onClick={summarize} loading={busy} variant={hasThemes ? 'outline' : 'default'}>
              {busy ? 'Grouping notes…' : hasThemes ? 'Re-summarize' : 'Summarize with AI'}
            </Button>
          </div>
        )}
      </div>
      {busy && <p className="mt-2 font-mono text-xs text-muted-foreground">This usually takes 10–30 seconds.</p>}
      {lockedBy && !busy && (
        <p role="status" className="mt-2 font-mono text-xs text-muted-foreground">
          {lockedBy} grouping these notes with AI right now…
        </p>
      )}

      {hasThemes && editing && (
        <ThemeEditor themes={themes.records} notes={notes} otherNames={otherNames} buildId={props.buildId} />
      )}

      {hasThemes && !editing && (
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

/**
 * Fix the AI's grouping by hand: rename a theme (for example to match a
 * theme on another build, so the compare page lines them up), or tick two
 * or more and merge them into one.
 */
function ThemeEditor(props: {
  themes: RecordData<ThemeData>[]
  notes: NotesById
  otherNames: string[]
  buildId: string
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [mergeName, setMergeName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { success } = useToast()
  const listId = `theme-names-${props.buildId}`

  // Merged themes disappear from the live list, and their ticks with them.
  const selected = props.themes.filter((t) => picked.includes(t.recordId))
  const biggest = [...selected].sort((a, b) => b.data.count - a.data.count)[0]

  function toggle(id: string) {
    setProblem(null)
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  }

  async function merge(e: FormEvent) {
    e.preventDefault()
    if (selected.length < 2) {
      setProblem('Tick at least two themes to merge.')
      return
    }
    const name = mergeName.trim() || biggest.data.name
    setBusy(true)
    setProblem(null)
    try {
      // The biggest theme goes first, so it's the one that's kept.
      const ids = [biggest, ...selected.filter((t) => t !== biggest)].map((t) => t.recordId)
      const r = await callAction<{ count: number }>('mergeThemes', { themeIds: ids, name })
      success('Themes merged', `"${name}" now has ${r.count} notes.`)
      setPicked([])
      setMergeName('')
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        Give a theme the same name as one on another build and the compare page will line them up. Tick two or more
        to merge them. Re-summarizing replaces these edits.
      </p>
      <datalist id={listId}>
        {props.otherNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <ul className="mt-3 divide-y divide-border">
        {props.themes.map((t) => (
          <ThemeEditRow
            // Keyed by name too, so the box resets when a merge renames the theme.
            key={`${t.recordId}:${t.data.name}`}
            theme={t}
            tag={dominantTag(t.data.feedbackIds, props.notes)}
            picked={picked.includes(t.recordId)}
            onToggle={() => toggle(t.recordId)}
            listId={listId}
          />
        ))}
      </ul>

      {selected.length > 0 && (
        <form onSubmit={merge} className="mt-4 rounded border border-border bg-background p-4">
          <Label htmlFor="merge-name">
            Merge {selected.length} {selected.length === 1 ? 'theme' : 'themes'} into
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="merge-name"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              placeholder={biggest?.data.name}
              maxLength={80}
              list={listId}
            />
            <Button type="submit" loading={busy}>
              Merge
            </Button>
          </div>
          {problem && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {problem}
            </p>
          )}
        </form>
      )}
    </div>
  )
}

function ThemeEditRow(props: {
  theme: RecordData<ThemeData>
  tag: Tag
  picked: boolean
  onToggle: () => void
  listId: string
}) {
  const { theme } = props
  const [name, setName] = useState(theme.data.name)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { success } = useToast()

  async function rename(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setProblem('Enter a name.')
      return
    }
    if (name.trim() === theme.data.name) {
      setProblem('Type a new name first.')
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await callAction('renameTheme', { themeId: theme.recordId, name })
      success('Theme renamed', name.trim())
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="py-3" data-theme-id={theme.recordId}>
      <form onSubmit={rename} className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={props.picked}
          onChange={props.onToggle}
          aria-label={`Select ${theme.data.name} to merge`}
          className="h-4 w-4 shrink-0 accent-primary"
        />
        <span className={cn('h-2 w-2 shrink-0 rounded-full', TAG_META[props.tag].dot)} aria-hidden />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Name of theme ${theme.data.name}`}
          maxLength={80}
          list={props.listId}
          className="h-9"
        />
        <span className="w-6 shrink-0 text-right font-mono text-sm">{theme.data.count}</span>
        <Button type="submit" size="sm" variant="outline" loading={busy}>
          Rename
        </Button>
      </form>
      {problem && (
        <p role="alert" className="mt-1 pl-7 text-sm text-destructive">
          {problem}
        </p>
      )}
    </li>
  )
}
