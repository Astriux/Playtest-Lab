/**
 * /sessions/:sessionId: the dev's view of one playtest. Shows the invite
 * link and every note. useQuery keeps the list live, so new notes appear
 * (and briefly glow) as testers send them.
 */

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useUserLookup } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { ScreenshotThumb } from '../../../../components/Screenshot'
import { ThemesPanel } from '../../../../components/Themes'
import { TAG_META, TagChip } from '../../../../components/Tag'
import { callAction } from '../../../../lib/actions'
import { inviteUrl, timeAgo } from '../../../../lib/format'
import { cn } from '../../../../lib/utils'
import {
  TAGS,
  type BuildData,
  type FeedbackData,
  type ProjectData,
  type SessionData,
  type Tag,
} from '../../../../schemas/playtest-schemas'

export default function SessionPage() {
  const { sessionId = '' } = useParams()
  const sessions = useQuery<SessionData>('sessions')
  const session = sessions.records.find((s) => s.recordId === sessionId)
  const projectId = session?.data.projectId ?? ''

  const projects = useQuery<ProjectData>('projects')
  const builds = useQuery<BuildData>('builds', { where: { projectId } })
  const notes = useQuery<FeedbackData>('feedback', { where: { sessionId }, orderBy: 'createdAt', orderDir: 'desc' })
  const { getName } = useUserLookup()
  const [filter, setFilter] = useState<Tag | 'all'>('all')
  // Notes created after the page opened are "new" and get a short glow.
  const [openedAt] = useState(() => Date.now())

  if (sessions.status === 'loading') {
    return <p className="mx-auto max-w-4xl px-5 py-10 text-sm text-muted-foreground sm:px-8">Loading…</p>
  }
  if (!session) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <h1 className="font-display text-2xl font-bold">Session not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It doesn't exist, or you're not on its project's team.</p>
      </div>
    )
  }

  const project = projects.records.find((p) => p.recordId === projectId)
  const build = builds.records.find((b) => b.recordId === session.data.buildId)
  const open = session.data.status === 'open'

  const counts = Object.fromEntries(TAGS.map((t) => [t, 0])) as Record<Tag, number>
  for (const n of notes.records) counts[n.data.tag] += 1
  const testerCount = new Set(notes.records.map((n) => n.data.testerId)).size
  const shown = filter === 'all' ? notes.records : notes.records.filter((n) => n.data.tag === filter)

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <Link
        to={`/projects/${projectId}`}
        className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        ← {project?.data.name ?? 'Project'}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">
          Playtest <span className="font-mono text-3xl font-medium">{build?.data.version}</span>
        </h1>
        <span
          className={
            open
              ? 'rounded-sm bg-signal px-2 py-0.5 font-mono text-xs font-medium uppercase text-white'
              : 'rounded-sm bg-muted px-2 py-0.5 font-mono text-xs font-medium uppercase text-muted-foreground'
          }
        >
          {open ? 'Live' : 'Ended'}
        </span>
      </div>

      {open && <InvitePanel sessionId={sessionId} inviteCode={session.data.inviteCode} />}

      <ThemesPanel
        projectId={projectId}
        buildId={session.data.buildId}
        sessionId={sessionId}
        version={build?.data.version ?? ''}
        sessionOpen={open}
      />

      <section className="mt-10" aria-labelledby="notes-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-b-2 border-foreground pb-2">
          <h2 id="notes-heading" className="font-display text-xl font-bold">
            {notes.records.length} {notes.records.length === 1 ? 'note' : 'notes'}{' '}
            <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">
              from {testerCount} {testerCount === 1 ? 'tester' : 'testers'}
            </span>
          </h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter notes by tag">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={notes.records.length} />
            {TAGS.map((t) => (
              <FilterChip
                key={t}
                active={filter === t}
                onClick={() => setFilter(t)}
                label={TAG_META[t].label}
                count={counts[t]}
                className={TAG_META[t].text}
              />
            ))}
          </div>
        </div>

        {notes.status === 'ready' && shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {notes.records.length > 0
              ? 'No notes with this tag.'
              : open
                ? 'Waiting for the first note. Share the invite link with your testers.'
                : 'No notes in this session.'}
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-live="polite">
            {shown.map((n) => (
              <li
                key={n.recordId}
                className={cn(
                  'grid gap-2 px-2 py-4 sm:grid-cols-[110px_1fr]',
                  Date.parse(n.createdAt) > openedAt && 'animate-note-arrive',
                )}
              >
                <div>
                  <TagChip tag={n.data.tag} />
                </div>
                <div>
                  <p className="text-sm">{n.data.text}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {getName(n.data.testerId) ?? 'Tester'} · {timeAgo(n.createdAt)}
                  </p>
                  {n.data.screenshotKey && (
                    <div className="mt-2">
                      <ScreenshotThumb feedbackId={n.recordId} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function FilterChip(props: { active: boolean; onClick: () => void; label: string; count: number; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        'rounded-sm border px-2 py-1 font-mono text-xs',
        props.active ? 'border-foreground bg-foreground text-background' : cn('border-border hover:border-foreground', props.className),
      )}
    >
      {props.label} {props.count}
    </button>
  )
}

function InvitePanel({ sessionId, inviteCode }: { sessionId: string; inviteCode: string }) {
  const [closing, setClosing] = useState(false)
  const { success, error } = useToast()
  const url = inviteUrl(inviteCode)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      success('Invite link copied')
    } catch {
      error('Could not copy', 'Select the link and copy it by hand.')
    }
  }

  async function endSession() {
    setClosing(true)
    try {
      await callAction('closeSession', { sessionId })
      success('Session ended', 'Testers can no longer add notes.')
    } catch (err) {
      error('Could not end session', (err as Error).message)
      setClosing(false)
    }
  }

  return (
    <div className="mt-6 rounded border border-border bg-card p-5">
      <p className="text-sm font-medium">Invite testers with this link</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Invite link"
          className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2 font-mono text-sm"
        />
        <Button onClick={copy}>Copy link</Button>
        <Button variant="outline" loading={closing} onClick={endSession}>
          End session
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Anyone with the link can sign in and leave notes until you end the session.
      </p>
    </div>
  )
}
