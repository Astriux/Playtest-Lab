/**
 * /projects/:projectId: builds, their playtest sessions, and the team.
 * All lists are live: useQuery re-renders when anyone changes the data.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { Button, Input, Label, Modal, Textarea, useToast } from '@/components/ui'
import { callAction } from '../../../../../lib/actions'
import { timeAgo } from '../../../../../lib/format'
import {
  projectOwnerId,
  type BuildData,
  type FeedbackData,
  type ProjectData,
  type SessionData,
  type TeamMemberData,
  type ThemeData,
} from '../../../../../schemas/playtest-schemas'

export default function ProjectPage() {
  const { projectId = '' } = useParams()
  const projects = useQuery<ProjectData>('projects')
  const builds = useQuery<BuildData>('builds', { where: { projectId }, orderBy: 'createdAt', orderDir: 'desc' })
  const sessions = useQuery<SessionData>('sessions', { where: { projectId }, orderBy: 'createdAt', orderDir: 'desc' })
  const feedback = useQuery<FeedbackData>('feedback', { where: { projectId } })
  const themes = useQuery<ThemeData>('themes', { where: { projectId } })
  const { userId } = useAuth()

  const project = projects.records.find((p) => p.recordId === projectId)

  if (projects.status === 'loading') {
    return <p className="mx-auto max-w-6xl px-5 py-10 text-sm text-muted-foreground sm:px-8">Loading…</p>
  }
  if (!project) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <h1 className="font-display text-2xl font-bold">Project not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It doesn't exist, or you're not on its team. Ask a teammate to add you.
        </p>
        <Link to="/home" className="mt-4 inline-block text-sm underline underline-offset-4">
          Back to projects
        </Link>
      </div>
    )
  }

  const ownerId = projectOwnerId(project)
  const isOwner = ownerId === userId
  const notesPerSession = new Map<string, number>()
  for (const f of feedback.records) {
    notesPerSession.set(f.data.sessionId, (notesPerSession.get(f.data.sessionId) ?? 0) + 1)
  }
  const themesPerBuild = new Map<string, number>()
  for (const t of themes.records) {
    themesPerBuild.set(t.data.buildId, (themesPerBuild.get(t.data.buildId) ?? 0) + 1)
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <Link to="/home" className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
        ← Projects
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">{project.data.name}</h1>
        {themesPerBuild.size >= 2 && (
          <Link
            to={`/projects/${projectId}/compare`}
            className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Compare builds
          </Link>
        )}
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="builds-heading">
          <h2 id="builds-heading" className="font-display text-xl font-bold">
            Builds
          </h2>
          {builds.status === 'ready' && builds.records.length === 0 ? (
            <p className="mt-4 rounded border border-dashed border-input bg-card px-5 py-8 text-sm text-muted-foreground">
              Add your first build to start a playtest. A build is one version of your game, like
              "v0.4 — new wave system".
            </p>
          ) : (
            <ol className="mt-4 space-y-4">
              {builds.records.map((build) => (
                <BuildCard
                  key={build.recordId}
                  build={build}
                  sessions={sessions.records.filter((s) => s.data.buildId === build.recordId)}
                  notesPerSession={notesPerSession}
                  themeCount={themesPerBuild.get(build.recordId) ?? 0}
                  isOwner={isOwner}
                />
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-8">
          <AddBuildForm projectId={projectId} />
          <TeamPanel projectId={projectId} ownerId={ownerId} />
          {/* Only the owner sees this. The server checks it too. */}
          {isOwner && (
            <DeleteProject
              projectId={projectId}
              name={project.data.name}
              counts={{
                builds: builds.records.length,
                sessions: sessions.records.length,
                notes: feedback.records.length,
              }}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function BuildCard({
  build,
  sessions,
  notesPerSession,
  themeCount,
  isOwner,
}: {
  build: RecordData<BuildData>
  sessions: RecordData<SessionData>[]
  notesPerSession: Map<string, number>
  themeCount: number
  isOwner: boolean
}) {
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { error } = useToast()

  async function startSession() {
    setBusy(true)
    try {
      const { sessionId } = await callAction<{ sessionId: string }>('openSession', { buildId: build.recordId })
      navigate(`/sessions/${sessionId}`)
    } catch (err) {
      error('Could not open session', (err as Error).message)
      setBusy(false)
    }
  }

  return (
    <li className="rounded border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="font-mono text-lg font-medium">{build.data.version}</p>
          <p className="font-mono text-xs text-muted-foreground">
            added {timeAgo(build.createdAt)}
            {themeCount > 0 && ` · ${themeCount} themes`}
          </p>
          {build.data.changelog && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{build.data.changelog}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" loading={busy} onClick={startSession}>
            Open playtest session
          </Button>
          {/* Only the owner sees this; the server checks it too. */}
          {isOwner && (
            <DeleteBuild
              build={build}
              sessions={sessions.length}
              notes={sessions.reduce((sum, s) => sum + (notesPerSession.get(s.recordId) ?? 0), 0)}
            />
          )}
        </div>
      </div>

      {sessions.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {sessions.map((s) => {
            const open = s.data.status === 'open'
            const notes = notesPerSession.get(s.recordId) ?? 0
            return (
              <li key={s.recordId}>
                <Link
                  to={`/sessions/${s.recordId}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={open ? 'h-2 w-2 animate-pulse rounded-full bg-signal' : 'h-2 w-2 rounded-full bg-input'}
                      aria-hidden
                    />
                    <span className="font-medium">{open ? 'Live session' : 'Session'}</span>
                    <span className="text-muted-foreground">· started {timeAgo(s.createdAt)}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {notes} {notes === 1 ? 'note' : 'notes'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "Delete build…" link plus its confirm dialog. Owner only. */
function DeleteBuild(props: { build: RecordData<BuildData>; sessions: number; notes: number }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { success } = useToast()
  const { version } = props.build.data

  function close() {
    setOpen(false)
    setProblem(null)
  }

  async function onDelete() {
    setBusy(true)
    setProblem(null)
    try {
      await callAction('deleteBuild', { buildId: props.build.recordId })
      success('Build deleted', version)
      // No need to close: the live list drops this build, and this dialog with it.
    } catch (err) {
      setProblem((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
      >
        Delete build…
      </button>
      <Modal open={open} onClose={close} size="sm">
        <Modal.Header>
          <Modal.Title className="font-display text-xl font-bold">Delete build {version}?</Modal.Title>
          <Modal.Description>
            This permanently removes {plural(props.sessions, 'session')} and{' '}
            {plural(props.notes, 'note')}, with their screenshots and themes, for everyone. Invite
            links for this build stop working. It can't be undone.
          </Modal.Description>
        </Modal.Header>
        {problem && (
          <Modal.Body>
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" loading={busy} onClick={onDelete}>
            Delete build
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

function AddBuildForm({ projectId }: { projectId: string }) {
  const [version, setVersion] = useState('')
  const [changelog, setChangelog] = useState('')
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const { error, success } = useToast()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!version.trim()) {
      setMissing(true)
      return
    }
    setMissing(false)
    setBusy(true)
    try {
      await callAction('addBuild', { projectId, version, changelog })
      success('Build added', version)
      setVersion('')
      setChangelog('')
    } catch (err) {
      error('Could not add build', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded border border-border bg-card p-5">
      <h2 className="font-display text-lg font-bold">Add a build</h2>
      <Label htmlFor="build-version" className="mt-4 block">
        Version
      </Label>
      <Input
        id="build-version"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="e.g. v1.2 or 2026-11-18"
        maxLength={40}
        aria-invalid={missing || undefined}
        className="mt-1 font-mono"
      />
      {missing && <p className="mt-1 text-sm text-destructive">Enter a version name, like v0.5.</p>}
      <Label htmlFor="build-changelog" className="mt-4 block">
        What changed
      </Label>
      <Textarea
        id="build-changelog"
        value={changelog}
        onChange={(e) => setChangelog(e.target.value)}
        placeholder="Made wave 7 easier, fixed the sell-tower crash"
        maxLength={1000}
        rows={3}
        className="mt-1"
      />
      <Button type="submit" className="mt-4 w-full" loading={busy}>
        Add build
      </Button>
    </form>
  )
}

function DeleteProject(props: {
  projectId: string
  name: string
  counts: { builds: number; sessions: number; notes: number }
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const navigate = useNavigate()
  const { success } = useToast()
  const { builds, sessions, notes } = props.counts

  function close() {
    setOpen(false)
    setTyped('')
    setProblem(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    // Clickable even when the name is wrong; say what's missing instead.
    if (typed.trim() !== props.name) {
      setProblem(`Type "${props.name}" exactly to confirm.`)
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await callAction('deleteProject', { projectId: props.projectId })
      success('Project deleted', props.name)
      navigate('/home', { replace: true })
    } catch (err) {
      setProblem((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="rounded border border-destructive/40 bg-card p-5">
      <h2 className="font-display text-lg font-bold">Delete project</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Only you, the owner, can do this. It removes the project for everyone on the team.
      </p>
      <Button variant="outline" className="mt-4 w-full text-destructive" onClick={() => setOpen(true)}>
        Delete project…
      </Button>

      <Modal open={open} onClose={close} size="sm">
        <form onSubmit={onSubmit}>
          <Modal.Header>
            <Modal.Title className="font-display text-xl font-bold">Delete “{props.name}”?</Modal.Title>
            <Modal.Description>
              This permanently removes {plural(builds, 'build')}, {plural(sessions, 'session')},{' '}
              {plural(notes, 'note')}, their screenshots and themes, for everyone. It can't be undone.
            </Modal.Description>
          </Modal.Header>
          <Modal.Body>
            <Label htmlFor="confirm-name">Type the project name to confirm</Label>
            <Input
              id="confirm-name"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={props.name}
              autoComplete="off"
              className="mt-1"
            />
            {problem && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {problem}
              </p>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={busy}>
              Delete project
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </section>
  )
}

/**
 * One teammate. The owner sees "Make owner" and "Remove" on everyone else;
 * anyone else sees "Leave" on their own row. Each asks once more in the row.
 */
function TeamRow(props: { projectId: string; memberId: string; name: string; ownerId: string }) {
  const { userId } = useAuth()
  const [confirming, setConfirming] = useState<'remove' | 'owner' | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { error, success } = useToast()

  const isOwnerRow = props.memberId === props.ownerId
  const isMe = props.memberId === userId
  const iAmOwner = userId === props.ownerId
  const canRemove = !isOwnerRow && (iAmOwner || isMe)
  const verb = isMe ? 'Leave' : 'Remove'

  async function act() {
    setBusy(true)
    const params = { projectId: props.projectId, userId: props.memberId }
    try {
      if (confirming === 'owner') {
        await callAction('transferOwnership', params)
        success(`${props.name} owns the project now`, "You're still on the team as a dev.")
      } else {
        await callAction('removeTeammate', params)
        if (isMe) {
          success('You left the project')
          navigate('/home', { replace: true })
          return
        }
        success('Teammate removed', props.name)
      }
    } catch (err) {
      error(confirming === 'owner' ? 'Could not hand over the project' : `Could not ${verb.toLowerCase()}`, (err as Error).message)
    }
    setBusy(false)
    setConfirming(null)
  }

  return (
    <li className="flex min-h-8 items-center justify-between gap-2">
      <span className="min-w-0 truncate">
        {props.name}
        {isOwnerRow && <span className="ml-2 font-mono text-xs text-muted-foreground">owner</span>}
        {isMe && !isOwnerRow && <span className="ml-2 font-mono text-xs text-muted-foreground">you</span>}
      </span>
      {canRemove &&
        (confirming ? (
          <span className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={confirming === 'owner' ? 'default' : 'destructive'}
              loading={busy}
              onClick={act}
            >
              {confirming === 'owner' ? 'Yes, make owner' : isMe ? 'Yes, leave' : 'Yes, remove'}
            </Button>
          </span>
        ) : (
          <span className="flex shrink-0 gap-3">
            {iAmOwner && (
              <button
                type="button"
                onClick={() => setConfirming('owner')}
                aria-label={`Make ${props.name} the owner`}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Make owner
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirming('remove')}
              aria-label={isMe ? 'Leave this project' : `Remove ${props.name}`}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-destructive hover:underline"
            >
              {verb}
            </button>
          </span>
        ))}
    </li>
  )
}

function TeamPanel({ projectId, ownerId }: { projectId: string; ownerId: string }) {
  const { records: members } = useQuery<TeamMemberData>('team_members', { where: { teamId: projectId } })
  const { getName } = useUserLookup()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, success } = useToast()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      error('Enter an email', "Type your teammate's email, then press Add.")
      return
    }
    setBusy(true)
    try {
      const { name } = await callAction<{ name: string }>('addTeammate', { projectId, email })
      success('Teammate added', name)
      setEmail('')
    } catch (err) {
      error('Could not add teammate', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const active = members.filter((m) => m.data.status === 'active')

  return (
    <section className="rounded border border-border bg-card p-5">
      <h2 className="font-display text-lg font-bold">Team</h2>
      <p className="mt-1 text-xs text-muted-foreground">Devs see every note. Testers only see their own.</p>
      <ul className="mt-3 space-y-1 text-sm">
        {active.map((m) => (
          <TeamRow
            key={m.recordId}
            projectId={projectId}
            memberId={m.data.userId}
            name={getName(m.data.userId) ?? 'Unknown user'}
            ownerId={ownerId}
          />
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@studio.com"
          aria-label="Teammate email"
        />
        <Button type="submit" variant="outline" loading={busy}>
          Add
        </Button>
      </form>
    </section>
  )
}
