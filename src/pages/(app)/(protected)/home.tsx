/**
 * /home: the projects you're on. The server only sends projects whose team
 * you're on, so this list needs no filtering of its own.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button, Input, Label, Modal } from '@/components/ui'
import { callAction } from '../../../lib/actions'
import { timeAgo } from '../../../lib/format'
import type { ProjectData } from '../../../schemas/playtest-schemas'

export default function HomePage() {
  const [creating, setCreating] = useState(false)
  const { records: projects, status } = useQuery<ProjectData>('projects', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Your lab</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">Projects</h1>
        </div>
        {projects.length > 0 && <Button onClick={() => setCreating(true)}>New project</Button>}
      </div>

      {status === 'loading' ? (
        <p className="mt-10 text-sm text-muted-foreground">Loading projects…</p>
      ) : projects.length === 0 ? (
        <div className="mt-8 rounded border border-dashed border-input bg-card px-6 py-12 text-center">
          <p className="font-display text-lg font-bold">No projects yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            A project is one game. It holds your builds and the playtest sessions you run on them.
          </p>
          <Button className="mt-6" onClick={() => setCreating(true)}>
            Create your first project
          </Button>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.recordId}>
              <Link
                to={`/projects/${p.recordId}`}
                className="block rounded border border-border bg-card p-5 transition-colors hover:border-foreground"
              >
                <span className="font-display text-lg font-bold">{p.data.name}</span>
                <span className="mt-1 block font-mono text-xs text-muted-foreground">
                  created {timeAgo(p.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  function close() {
    setName('')
    setError(null)
    onClose()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    // The button is never disabled: a greyed-out button with no reason is
    // what confused people. Say what's missing instead.
    if (!name.trim()) {
      setError('Enter a game name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { projectId } = await callAction<{ projectId: string }>('createProject', { name })
      navigate(`/projects/${projectId}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} size="sm">
      <form onSubmit={onSubmit}>
        <Modal.Header>
          <Modal.Title className="font-display text-xl font-bold">New project</Modal.Title>
          <Modal.Description>One project per game. You'll add builds to it next.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <Label htmlFor="project-name">Game name</Label>
          <Input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tower Defense"
            maxLength={80}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'project-name-error' : undefined}
            className="mt-1"
          />
          {error && (
            <p id="project-name-error" role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create project
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
