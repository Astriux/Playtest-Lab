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

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  TAGS,
  type BuildData,
  type ProjectData,
  type SessionData,
  type Tag,
} from '../schemas/playtest-schemas'

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

async function isTeamMember(tools: ActionTools, projectId: string, userId: string) {
  const res = await tools.query('team_members', {
    where: { teamId: projectId, userId, status: 'active' },
    limit: 1,
  })
  return res.success && res.data.records.length > 0
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

const createProject: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const name = cleanText(params.name, 80)
  if (!name) return fail('Give the project a name (up to 80 characters).')

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
const submitFeedback: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const session = await findSessionByCode(tools, params.inviteCode)
  if (!session) return fail('This invite link is not valid.')
  if (session.data.status !== 'open') return fail('This playtest session has ended.')

  const tag = params.tag as Tag
  if (!TAGS.includes(tag)) return fail('Pick a tag: bug, balance, confusing, or fun.')
  const text = cleanText(params.text, 1000)
  if (!text) return fail('Write a note (up to 1000 characters).')

  const res = await tools.create('feedback', {
    projectId: session.data.projectId,
    buildId: session.data.buildId,
    sessionId: session.recordId,
    testerId: userId,
    tag,
    text,
    screenshotKey: '',
  })
  if (!res.success) return res
  return ok({ feedbackId: res.data.recordId })
}

export const actions: Record<string, ActionHandler<Env>> = {
  createProject,
  addTeammate,
  addBuild,
  openSession,
  closeSession,
  joinSession,
  submitFeedback,
}
