/**
 * /home: the projects you're on. The server only sends projects whose team
 * you're on, so this list needs no filtering of its own.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button, Input, useToast } from '@/components/ui'
import { callAction } from '../../../lib/actions'
import { timeAgo } from '../../../lib/format'
import type { ProjectData } from '../../../schemas/playtest-schemas'

export default function HomePage() {
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
        <NewProjectForm />
      </div>

      {status === 'loading' ? (
        <p className="mt-10 text-sm text-muted-foreground">Loading projects…</p>
      ) : projects.length === 0 ? (
        <div className="mt-8 rounded border border-dashed border-input bg-card px-6 py-12 text-center">
          <p className="font-display text-lg font-bold">No projects yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            A project is one game. It holds your builds and the playtest sessions you run on them.
          </p>
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
    </div>
  )
}

function NewProjectForm() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { error } = useToast()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const { projectId } = await callAction<{ projectId: string }>('createProject', { name })
      navigate(`/projects/${projectId}`)
    } catch (err) {
      error('Could not create project', (err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full gap-2 sm:w-auto">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Game name, e.g. Tower Defense"
        maxLength={80}
        aria-label="New project name"
        className="sm:w-64"
      />
      <Button type="submit" loading={busy} disabled={!name.trim()}>
        New project
      </Button>
    </form>
  )
}
