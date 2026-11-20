/**
 * /projects/:projectId/compare?from=<buildId>&to=<buildId>
 * Did the fix work? Lines up two builds' themes by name and shows what went
 * down, up, appeared, or disappeared. Defaults to the latest two summarized
 * builds.
 */

import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, type RecordData } from 'deepspace'
import { dominantTag, ThemeNotes, type NotesById } from '../../../../../components/Themes'
import { TAG_META } from '../../../../../components/Tag'
import {
  compareThemes,
  countChanges,
  FEW_TESTERS,
  tallyThemes,
  type ComparisonRow,
  type Side,
} from '../../../../../lib/themes'
import { cn } from '../../../../../lib/utils'
import type { BuildData, FeedbackData, ProjectData, ThemeData } from '../../../../../schemas/playtest-schemas'

type Theme = ThemeData

export default function ComparePage() {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const projects = useQuery<ProjectData>('projects')
  const builds = useQuery<BuildData>('builds', { where: { projectId }, orderBy: 'createdAt', orderDir: 'asc' })
  const themes = useQuery<ThemeData>('themes', { where: { projectId } })
  const feedback = useQuery<FeedbackData>('feedback', { where: { projectId } })

  const project = projects.records.find((p) => p.recordId === projectId)
  const backLink = (
    <Link
      to={`/projects/${projectId}`}
      className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
    >
      ← {project?.data.name ?? 'Project'}
    </Link>
  )

  if ([projects, builds, themes].some((q) => q.status === 'loading')) {
    return <p className="mx-auto max-w-4xl px-5 py-10 text-sm text-muted-foreground sm:px-8">Loading…</p>
  }

  // Only builds that have been summarized can be compared.
  const summarized = builds.records.filter((b) => themes.records.some((t) => t.data.buildId === b.recordId))
  if (!project || summarized.length < 2) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        {backLink}
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">Compare builds</h1>
        <p className="mt-4 max-w-lg text-sm text-muted-foreground">
          {project
            ? 'You need two summarized builds. For each build: run a playtest session, end it, then press "Summarize with AI" on the session page.'
            : "This project doesn't exist, or you're not on its team."}
        </p>
        {project && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Summarized so far: {summarized.map((b) => b.data.version).join(', ') || 'none'}
          </p>
        )}
      </div>
    )
  }

  const isSummarized = (id: string | null) => !!id && summarized.some((b) => b.recordId === id)
  const toId = isSummarized(params.get('to')) ? params.get('to')! : summarized.at(-1)!.recordId
  const toIndex = summarized.findIndex((b) => b.recordId === toId)
  const fallbackFrom = (summarized[toIndex - 1] ?? summarized.find((b) => b.recordId !== toId))!.recordId
  const fromId = isSummarized(params.get('from')) && params.get('from') !== toId ? params.get('from')! : fallbackFrom
  const from = summarized.find((b) => b.recordId === fromId)!
  const to = summarized.find((b) => b.recordId === toId)!

  // Who wrote each note, so themes can be measured in testers, not notes.
  const testerOf = new Map(feedback.records.map((n) => [n.recordId, n.data.testerId]))
  const testersOn = (buildId: string) =>
    new Set(feedback.records.filter((n) => n.data.buildId === buildId).map((n) => n.data.testerId)).size
  const tally = (buildId: string) => ({
    testers: testersOn(buildId),
    themes: tallyThemes(
      themes.records.filter((t) => t.data.buildId === buildId).map((t) => t.data),
      testerOf,
    ),
  })
  const rows = compareThemes(tally(fromId), tally(toId))
  const changes = countChanges(rows)
  const notes: NotesById = new Map(feedback.records.map((n) => [n.recordId, n]))
  const fewTesters = [from, to].filter((b) => testersOn(b.recordId) < FEW_TESTERS)

  function pick(which: 'from' | 'to', id: string) {
    const next = { from: fromId, to: toId, [which]: id }
    setParams(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      {backLink}
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">Did the fix work?</h1>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <BuildPicker label="Before" value={fromId} builds={summarized} disabledId={toId} onChange={(id) => pick('from', id)} />
        <span className="pb-2 font-mono text-muted-foreground" aria-hidden>
          →
        </span>
        <BuildPicker label="After" value={toId} builds={summarized} disabledId={fromId} onChange={(id) => pick('to', id)} />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <BuildTotals build={from} notes={feedback.records} />
        <BuildTotals build={to} notes={feedback.records} />
      </div>

      {fewTesters.length > 0 && (
        <p className="mt-4 rounded border border-tag-balance/50 bg-card px-4 py-3 text-sm">
          {fewTesters.map((b) => b.data.version).join(' and ')} had fewer than {FEW_TESTERS} testers. One person
          changes the percentages a lot, so treat small moves with care.
        </p>
      )}

      <p className="mt-8 border-b-2 border-foreground pb-2 font-mono text-xs">
        {changes.down} down · {changes.up} up · {changes.new} new · {changes.gone} gone · {changes.same} same
      </p>

      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <CompareRow
            key={row.name}
            row={row}
            notes={notes}
            fromVersion={from.data.version}
            toVersion={to.data.version}
          />
        ))}
      </ul>

      <p className="mt-6 text-xs text-muted-foreground">
        Each bar is the share of that build's testers who raised the theme, so a smaller playtest doesn't look like
        a fix. Moves under 10 points count as "same". Themes match by name: the AI reuses the previous build's names
        for the same issue, and you can rename or merge themes on a session page. Open a theme to see its notes.
      </p>
    </div>
  )
}

function BuildPicker(props: {
  label: string
  value: string
  builds: RecordData<BuildData>[]
  disabledId: string
  onChange: (id: string) => void
}) {
  return (
    <label className="block">
      <span className="font-mono text-xs uppercase text-muted-foreground">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 block rounded border border-input bg-card px-3 py-2 font-mono text-sm"
      >
        {props.builds.map((b) => (
          <option key={b.recordId} value={b.recordId} disabled={b.recordId === props.disabledId}>
            {b.data.version}
          </option>
        ))}
      </select>
    </label>
  )
}

function BuildTotals({ build, notes }: { build: RecordData<BuildData>; notes: RecordData<FeedbackData>[] }) {
  const mine = notes.filter((n) => n.data.buildId === build.recordId)
  const testers = new Set(mine.map((n) => n.data.testerId)).size
  return (
    <div className="rounded border border-border bg-card px-4 py-3">
      <p className="font-mono text-sm font-medium">{build.data.version}</p>
      <p className="text-xs text-muted-foreground">
        {mine.length} notes from {testers} {testers === 1 ? 'tester' : 'testers'}
        {build.data.changelog ? ` · ${build.data.changelog}` : ''}
      </p>
    </div>
  )
}

function CompareRow(props: {
  row: ComparisonRow<Theme>
  notes: NotesById
  fromVersion: string
  toVersion: string
}) {
  const { row, notes } = props
  const beforeIds = row.beforeTheme?.feedbackIds ?? []
  const afterIds = row.afterTheme?.feedbackIds ?? []
  const tag = dominantTag([...beforeIds, ...afterIds], notes)
  const v = verdict(row, tag === 'fun')

  return (
    <li>
      <details className="group py-4">
        <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', TAG_META[tag].dot)} aria-hidden />
            <span className="truncate font-medium">{row.name}</span>
          </span>
          <span className={cn('font-mono text-xs font-medium uppercase', v.className)}>{v.label}</span>
          <span className="col-span-2 grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{props.fromVersion}</span>
            <Bar rate={row.before.rate} className="bg-foreground/30" />
            <span className="text-right">{percent(row.before.rate)}</span>
            <span className="truncate">{props.toVersion}</span>
            <Bar rate={row.after.rate} className={TAG_META[tag].dot} />
            <span className="text-right">{percent(row.after.rate)}</span>
          </span>
        </summary>
        <div className="mt-4 grid gap-4 pl-4 sm:grid-cols-2">
          <NotesColumn title={props.fromVersion} side={row.before} ids={beforeIds} notes={notes} />
          <NotesColumn title={props.toVersion} side={row.after} ids={afterIds} notes={notes} />
        </div>
      </details>
    </li>
  )
}

const percent = (rate: number) => `${Math.round(rate * 100)}%`

/** A bar from 0% to 100% of the build's testers. */
function Bar({ rate, className }: { rate: number; className: string }) {
  return (
    <span className="h-1.5 rounded-sm bg-muted">
      <span className={cn('block h-full rounded-sm', className)} style={{ width: percent(rate) }} />
    </span>
  )
}

function NotesColumn(props: { title: string; side: Side; ids: string[]; notes: NotesById }) {
  const { title, side, ids, notes } = props
  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase text-muted-foreground">
        {title} · {side.testers} {side.testers === 1 ? 'tester' : 'testers'} · {side.notes}{' '}
        {side.notes === 1 ? 'note' : 'notes'}
      </p>
      {ids.length === 0 ? <p className="text-xs text-muted-foreground">No notes.</p> : <ThemeNotes ids={ids} notes={notes} />}
    </div>
  )
}

/** Green when things got better. For praise themes, "better" means more. */
function verdict(row: ComparisonRow<Theme>, praise: boolean) {
  const points = Math.round(Math.abs(row.after.rate - row.before.rate) * 100)
  const label = { down: `▼ ${points} pts`, up: `▲ ${points} pts`, new: 'New', gone: 'Gone', same: 'Same' }[row.change]
  const better = praise ? ['up', 'new'] : ['down', 'gone']
  const worse = praise ? ['down', 'gone'] : ['up', 'new']
  const className = better.includes(row.change)
    ? 'text-tag-fun'
    : worse.includes(row.change)
      ? 'text-tag-bug'
      : 'text-muted-foreground'
  return { label, className }
}
