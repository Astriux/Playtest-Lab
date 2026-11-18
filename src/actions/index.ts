/**
 * Server actions: the only way to create project data.
 *
 * Each action is reachable at POST /api/actions/<name>. The worker has
 * already verified the caller's sign-in token, so `userId` is trustworthy.
 *
 * IMPORTANT: `tools.*` ignores the collection permissions (it runs "as the
 * app"). So every action must decide for itself whether the caller is allowed
 * to do this, usually with `isTeamMember`. Never trust ids or owner fields
 * from `params` without checking them.
 */

import { appFiles } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  TAGS,
  type BuildData,
  type FeedbackData,
  type ProjectData,
  type SessionData,
  type Tag,
} from '../schemas/playtest-schemas'
import { isTeamMember } from '../server/access'
import { clusterNotes } from '../server/summarize'
import { cleanThemes, type RawTheme } from '../lib/themes'
import type { ThemeData } from '../schemas/playtest-schemas'
import { DEMO_BUILDS, DEMO_PROJECT_NAME, demoTesterId } from '../demo/tower-defense'

// ── Small helpers ────────────────────────────────────────────────────────────

const fail = (error: string): ActionResult => ({ success: false, error })
const ok = <T>(data: T): ActionResult<T> => ({ success: true, data })

/** Trimmed text within a length limit, or null if missing / too long. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

/** Optional text: '' when absent, null when present but too long. */
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : null
}

/** One membership row per (project, user), so re-adding someone updates it. */
const memberId = (projectId: string, userId: string) => `${projectId}_${userId}`

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024

/**
 * Decode a base64 screenshot and work out its type from its first bytes,
 * not from anything the browser claims. Only JPEG, PNG and WebP pass, so
 * nothing that a browser would run (HTML, SVG) can be stored.
 */
function readScreenshot(value: unknown): { bytes: Uint8Array<ArrayBuffer>; type: string } | null {
  if (typeof value !== 'string' || value.length > (MAX_SCREENSHOT_BYTES * 4) / 3 + 4) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0))
  } catch {
    return null
  }
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts(0xff, 0xd8, 0xff)) return { bytes, type: 'image/jpeg' }
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { bytes, type: 'image/png' }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { bytes, type: 'image/webp' }
  return null
}

/** 10 characters from an alphabet without look-alikes (no 0/o, 1/l/i). */
function newInviteCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

async function findSessionByCode(tools: ActionTools, code: unknown) {
  const inviteCode = cleanText(code, 32)
  if (!inviteCode) return null
  const res = await tools.query<SessionData>('sessions', { where: { inviteCode }, limit: 1 })
  return res.success ? (res.data.records[0] ?? null) : null
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Create a project with the caller as its first (and only) dev. */
async function newProject(tools: ActionTools, userId: string, name: string): Promise<ActionResult<{ projectId: string }>> {
  // We pick the id ourselves so the project can point at its own team.
  const projectId = crypto.randomUUID()
  const project = await tools.create<ProjectData>('projects', { name, teamId: projectId }, projectId)
  if (!project.success) return project

  const member = await tools.create(
    'team_members',
    { teamId: projectId, userId, status: 'active' },
    memberId(projectId, userId),
  )
  if (!member.success) return member

  return ok({ projectId })
}

const createProject: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const name = cleanText(params.name, 80)
  if (!name) return fail('Give the project a name (up to 80 characters).')
  return newProject(tools, userId, name)
}

/**
 * Build the demo project (src/demo/tower-defense.ts) for the caller: three
 * builds, sessions, notes from four made-up testers, and ready-made themes.
 * The caller is its only dev, exactly like a project they made themselves.
 */
const createDemoProject: ActionHandler<Env> = async ({ userId, tools }) => {
  const created = await newProject(tools, userId, DEMO_PROJECT_NAME)
  if (!created.success) return created
  const { projectId } = created.data

  for (const demo of DEMO_BUILDS) {
    const build = await tools.create<BuildData>('builds', {
      projectId,
      version: demo.version,
      changelog: demo.changelog,
    })
    if (!build.success) return build
    const buildId = build.data.recordId

    const session = await tools.create<SessionData>('sessions', {
      projectId,
      buildId,
      status: demo.sessionOpen ? 'open' : 'closed',
      inviteCode: newInviteCode(),
    })
    if (!session.success) return session

    const noteIds: string[] = []
    for (const note of demo.notes) {
      const res = await tools.create<FeedbackData>('feedback', {
        projectId,
        buildId,
        sessionId: session.data.recordId,
        testerId: demoTesterId(note.tester),
        tag: note.tag,
        text: note.text,
        screenshotKey: '',
      })
      if (!res.success) return res
      noteIds.push(res.data.recordId)
    }

    for (const theme of demo.themes) {
      const res = await tools.create<ThemeData>('themes', {
        projectId,
        buildId,
        name: theme.name,
        summary: theme.summary,
        count: theme.notes.length,
        feedbackIds: theme.notes.map((i) => noteIds[i]),
      })
      if (!res.success) return res
    }
  }

  return ok({ projectId })
}

const addTeammate: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const projectId = cleanText(params.projectId, 64)
  const email = cleanText(params.email, 254)?.toLowerCase()
  if (!projectId || !email) return fail('Enter an email address.')
  if (!(await isTeamMember(tools, projectId, userId))) return fail('You are not on this project.')

  const users = await tools.query('users', { where: { email }, limit: 1 })
  const teammate = users.success ? users.data.records[0] : undefined
  if (!teammate) return fail('Nobody with that email has signed in to Playtest Lab yet.')

  const res = await tools.create(
    'team_members',
    { teamId: projectId, userId: teammate.recordId, status: 'active' },
    memberId(projectId, teammate.recordId),
  )
  if (!res.success) return res
  // Return only the name: action tools see full user rows, emails included.
  return ok({ name: String(teammate.data.name ?? email) })
}

const addBuild: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const projectId = cleanText(params.projectId, 64)
  const version = cleanText(params.version, 40)
  const changelog = optionalText(params.changelog, 1000)
  if (!projectId || !version) return fail('Give the build a version name (up to 40 characters).')
  if (changelog === null) return fail('Keep the changelog under 1000 characters.')
  if (!(await isTeamMember(tools, projectId, userId))) return fail('You are not on this project.')

  const res = await tools.create<BuildData>('builds', { projectId, version, changelog })
  if (!res.success) return res
  return ok({ buildId: res.data.recordId })
}

const openSession: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const buildId = cleanText(params.buildId, 64)
  if (!buildId) return fail('Missing build.')
  const build = await tools.get<BuildData>('builds', buildId)
  if (!build.success) return fail('Build not found.')
  const { projectId } = build.data.record.data
  if (!(await isTeamMember(tools, projectId, userId))) return fail('You are not on this project.')

  const inviteCode = newInviteCode()
  const res = await tools.create<SessionData>('sessions', {
    projectId,
    buildId,
    status: 'open',
    inviteCode,
  })
  if (!res.success) return res
  return ok({ sessionId: res.data.recordId, inviteCode })
}

const closeSession: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const sessionId = cleanText(params.sessionId, 64)
  if (!sessionId) return fail('Missing session.')
  const session = await tools.get<SessionData>('sessions', sessionId)
  if (!session.success) return fail('Session not found.')
  if (!(await isTeamMember(tools, session.data.record.data.projectId, userId))) {
    return fail('You are not on this project.')
  }
  const res = await tools.update<SessionData>('sessions', sessionId, { status: 'closed' })
  if (!res.success) return res
  return ok({ sessionId })
}

/**
 * A tester opens an invite link. Testers can't read sessions or projects
 * directly, so this returns only what the join page needs to show.
 */
const joinSession: ActionHandler<Env> = async ({ params, tools }) => {
  const session = await findSessionByCode(tools, params.inviteCode)
  if (!session) return fail('This invite link is not valid.')

  const { projectId, buildId, status } = session.data
  const [project, build] = await Promise.all([
    tools.get<ProjectData>('projects', projectId),
    tools.get<BuildData>('builds', buildId),
  ])
  if (!project.success || !build.success) return fail('This invite link is not valid.')

  return ok({
    sessionId: session.recordId,
    status,
    projectName: project.data.record.data.name,
    version: build.data.record.data.version,
    changelog: build.data.record.data.changelog,
  })
}

/**
 * A tester leaves a note. Everything except tag + text comes from the server:
 * the session is looked up by invite code, and the project, build and tester
 * ids are copied from that session and the verified caller.
 *
 * The tester must make this call themselves: list views decide "own rows" by
 * who created the row, so feedback created by someone else would be invisible
 * to the tester (see NOTES.md, step 1, question a).
 */
const submitFeedback: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const session = await findSessionByCode(tools, params.inviteCode)
  if (!session) return fail('This invite link is not valid.')
  if (session.data.status !== 'open') return fail('This playtest session has ended.')

  const tag = params.tag as Tag
  if (!TAGS.includes(tag)) return fail('Pick a tag: bug, balance, confusing, or fun.')
  const text = cleanText(params.text, 1000)
  if (!text) return fail('Write a note (up to 1000 characters).')

  const { projectId, buildId } = session.data
  const feedbackId = crypto.randomUUID()
  // The tester's own private folder ('self' scope): nobody else can open it
  // directly. The team sees it only through /api/screenshots, which checks.
  const files = appFiles(env, { scope: 'self', userId })
  let screenshotKey = ''

  if (params.screenshot) {
    const shot = readScreenshot(params.screenshot)
    if (!shot) return fail('Screenshots must be a JPEG, PNG or WebP image under 2 MB.')
    if (shot.bytes.length > MAX_SCREENSHOT_BYTES) return fail('That screenshot is over 2 MB.')
    const stored = await files.upload(new Blob([shot.bytes], { type: shot.type }), {
      key: `screenshots/${feedbackId}`,
    })
    screenshotKey = stored.key
  }

  const res = await tools.create<FeedbackData>(
    'feedback',
    { projectId, buildId, sessionId: session.recordId, testerId: userId, tag, text, screenshotKey },
    feedbackId,
  )
  if (!res.success) {
    if (screenshotKey) await files.delete(screenshotKey)
    return res
  }
  return ok({ feedbackId })
}

const MAX_NOTES_TO_SUMMARIZE = 300

/**
 * Group a build's notes into themes with Claude. Team only.
 *
 * Themes belong to a build, not a session, so this groups every note on the
 * session's build (all of its sessions) and replaces that build's themes.
 * The previous build's theme names go into the prompt so the same issue
 * keeps the same name, which is what makes build-to-build comparison work.
 */
const summarizeSession: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const sessionId = cleanText(params.sessionId, 64)
  if (!sessionId) return fail('Missing session.')
  const session = await tools.get<SessionData>('sessions', sessionId)
  if (!session.success) return fail('Session not found.')
  const { projectId, buildId, status } = session.data.record.data
  if (!(await isTeamMember(tools, projectId, userId))) return fail('You are not on this project.')
  if (status !== 'closed') return fail('End the session first, so no new notes arrive while themes are made.')

  const [build, notesRes, buildsRes] = await Promise.all([
    tools.get<BuildData>('builds', buildId),
    tools.query<FeedbackData>('feedback', { where: { buildId }, orderBy: 'createdAt', limit: MAX_NOTES_TO_SUMMARIZE }),
    tools.query<BuildData>('builds', { where: { projectId }, orderBy: 'createdAt', orderDir: 'asc' }),
  ])
  if (!build.success || !notesRes.success || !buildsRes.success) return fail('Could not load the notes.')
  const notes = notesRes.data.records
  if (notes.length === 0) return fail('No notes to summarize yet.')

  // The newest earlier build that has themes is "the previous build".
  const builds = buildsRes.data.records
  const earlier = builds.slice(0, builds.findIndex((b) => b.recordId === buildId)).reverse()
  let previousThemes: { name: string; summary: string }[] = []
  for (const b of earlier) {
    const res = await tools.query<ThemeData>('themes', { where: { buildId: b.recordId } })
    if (res.success && res.data.records.length > 0) {
      previousThemes = res.data.records.map((t) => ({ name: t.data.name, summary: t.data.summary }))
      break
    }
  }

  // Short ids (n1, n2…) for the model; we map them back afterwards.
  const shortToReal = new Map(notes.map((n, i) => [`n${i + 1}`, n.recordId]))
  let raw: RawTheme[]
  try {
    raw = await clusterNotes(env, {
      version: build.data.record.data.version,
      changelog: build.data.record.data.changelog,
      previousThemes,
      notes: notes.map((n, i) => ({ id: `n${i + 1}`, tag: n.data.tag, text: n.data.text })),
    })
  } catch (err) {
    console.error('[summarizeSession] AI call failed:', err)
    return fail("The AI couldn't group the notes right now. Try again in a minute.")
  }
  const themes = cleanThemes(
    raw.map((t) => ({ ...t, noteIds: t.noteIds.map((id) => shortToReal.get(id) ?? '') })),
    notes.map((n) => n.recordId),
  )

  // Replace this build's themes. deleteWhere removes at most 500 per call.
  for (;;) {
    const del = await tools.deleteWhere('themes', { buildId }, 500)
    if (!del.success) return del
    if (del.data.deleted < 500) break
  }
  for (const t of themes) {
    const res = await tools.create<ThemeData>('themes', {
      projectId,
      buildId,
      name: t.name,
      summary: t.summary,
      count: t.noteIds.length,
      feedbackIds: t.noteIds,
    })
    if (!res.success) return res
  }

  const previousNames = new Set(previousThemes.map((t) => t.name))
  return ok({
    themeCount: themes.length,
    noteCount: notes.length,
    matchedPrevious: themes.filter((t) => previousNames.has(t.name)).length,
  })
}

export const actions: Record<string, ActionHandler<Env>> = {
  summarizeSession,
  createProject,
  createDemoProject,
  addTeammate,
  addBuild,
  openSession,
  closeSession,
  joinSession,
  submitFeedback,
}
