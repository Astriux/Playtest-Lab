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

import { appFiles, AppFileError } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  projectOwnerId,
  TAGS,
  type BuildData,
  type FeedbackData,
  type ProjectData,
  type SessionData,
  type SummarizeLockData,
  type Tag,
} from '../schemas/playtest-schemas'
import { isTeamMember } from '../server/access'
import { clusterNotes } from '../server/summarize'
import { cleanThemeName, cleanThemes, mergeThemes as combineThemes, themeKey, type RawTheme } from '../lib/themes'
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

/**
 * Optional clip link: '' when absent, null when invalid. Only https links
 * are kept, which rules out javascript:, data: and plain-http links.
 */
function readClipUrl(value: unknown): string | null {
  const raw = optionalText(value, 500)
  if (raw === null || raw === '') return raw
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024

/**
 * Screenshot caps per playtest session. The free plan has 128 MiB of file
 * storage for the whole app; screenshots are downscaled to about 0.2-0.5 MB,
 * so one session can use at most roughly 25 MB, and one tester can't fill it.
 */
export const MAX_SHOTS_PER_SESSION = 50
export const MAX_SHOTS_PER_TESTER = 10

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
  const project = await tools.create<ProjectData>('projects', { name, teamId: projectId, ownerId: userId }, projectId)
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

/**
 * Take someone off a project's team. The owner can remove any teammate, and
 * any teammate can remove themselves (leave). The owner can't be removed:
 * the project would have nobody who can delete it. The removed person loses
 * access at once, because every read and live update re-checks the team.
 */
const removeTeammate: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const projectId = cleanText(params.projectId, 64)
  const target = cleanText(params.userId, 64)
  if (!projectId || !target) return fail('Missing project or teammate.')
  if (!(await isTeamMember(tools, projectId, userId))) return fail('You are not on this project.')
  const project = await tools.get<ProjectData>('projects', projectId)
  if (!project.success) return fail('Project not found.')
  const ownerId = projectOwnerId(project.data.record)

  if (target === ownerId) return fail("The owner can't be removed. Delete the project instead.")
  if (target !== userId && userId !== ownerId) return fail('Only the project owner can remove teammates.')
  if (!(await isTeamMember(tools, projectId, target))) return fail('That person is not on this project.')

  const res = await deleteAll(tools, 'team_members', { teamId: projectId, userId: target })
  if (!res.success) return res
  return ok({ projectId, left: target === userId })
}

/**
 * Hand the project to another dev on the team. Only the current owner can,
 * and they stay on the team as a regular dev afterwards.
 */
const transferOwnership: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const projectId = cleanText(params.projectId, 64)
  const target = cleanText(params.userId, 64)
  if (!projectId || !target) return fail('Missing project or teammate.')
  if (!(await isTeamMember(tools, projectId, userId))) return fail('You are not on this project.')
  const project = await tools.get<ProjectData>('projects', projectId)
  if (!project.success) return fail('Project not found.')
  if (projectOwnerId(project.data.record) !== userId) return fail('Only the project owner can hand it over.')
  if (target === userId) return fail('You already own this project.')
  if (!(await isTeamMember(tools, projectId, target))) return fail('Add them to the team first.')

  const res = await tools.update<ProjectData>('projects', projectId, { ownerId: target })
  if (!res.success) return res
  return ok({ projectId, ownerId: target })
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
  const clipUrl = readClipUrl(params.clipUrl)
  if (clipUrl === null) return fail('Clip links must be a full https:// link, like https://medal.tv/…')

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
    const capped = await screenshotCapReached(tools, session.recordId, userId)
    if (capped) return fail(capped)
    const stored = await files.upload(new Blob([shot.bytes], { type: shot.type }), {
      key: `screenshots/${feedbackId}`,
    })
    screenshotKey = stored.key
  }

  const res = await tools.create<FeedbackData>(
    'feedback',
    { projectId, buildId, sessionId: session.recordId, testerId: userId, tag, text, screenshotKey, clipUrl },
    feedbackId,
  )
  if (!res.success) {
    if (screenshotKey) await files.delete(screenshotKey)
    return res
  }
  return ok({ feedbackId })
}

/**
 * Has this session (or this tester in it) used up its screenshots? Returns
 * the message to show, or null. Two uploads landing in the same instant could
 * both pass at 49 and end at 51; a cap this loose doesn't need to be exact.
 */
async function screenshotCapReached(tools: ActionTools, sessionId: string, testerId: string) {
  const res = await tools.query<FeedbackData>('feedback', { where: { sessionId } })
  if (!res.success) return 'Could not check the screenshot limit. Try again.'
  const shots = res.data.records.filter((n) => n.data.screenshotKey)
  if (shots.length >= MAX_SHOTS_PER_SESSION) {
    return `This session already has ${MAX_SHOTS_PER_SESSION} screenshots, the most it can hold. Send the note without one, or add a clip link.`
  }
  if (shots.filter((n) => n.data.testerId === testerId).length >= MAX_SHOTS_PER_TESTER) {
    return `You've sent ${MAX_SHOTS_PER_TESTER} screenshots in this session, the most per tester. Send the note without one, or add a clip link.`
  }
  return null
}

/** Delete every row matching `where`; deleteWhere removes at most 500 per call. */
async function deleteAll(tools: ActionTools, collection: string, where: Record<string, string>) {
  for (;;) {
    const res = await tools.deleteWhere(collection, where, 500)
    if (!res.success) return res
    if (res.data.deleted < 500) return ok({})
  }
}

/**
 * Delete the screenshot files of these notes. They live in each tester's
 * private folder, not in the records, so deleting rows alone would leave them.
 * Returns false if a file couldn't be deleted (one already gone is fine).
 */
async function deleteScreenshots(env: Env, notes: { data: FeedbackData }[]) {
  for (const { data } of notes) {
    if (!data.screenshotKey) continue
    try {
      await appFiles(env, { scope: 'self', userId: data.testerId }).delete(data.screenshotKey)
    } catch (err) {
      if (!(err instanceof AppFileError && err.status === 404)) {
        console.error('[deleteScreenshots] failed:', err)
        return false
      }
    }
  }
  return true
}

/**
 * Only the project's owner (the dev who created it) may delete things that
 * hold testers' notes. Returns an error message, or null if allowed.
 * Non-members get the same answer whether or not the project exists.
 */
async function ownerOnly(tools: ActionTools, projectId: string, userId: string, what: string) {
  if (!(await isTeamMember(tools, projectId, userId))) return 'You are not on this project.'
  const project = await tools.get<ProjectData>('projects', projectId)
  if (!project.success) return 'Project not found.'
  if (projectOwnerId(project.data.record) !== userId) return `Only the project owner can delete ${what}.`
  return null
}

const SCREENSHOT_DELETE_FAILED = 'Could not delete the screenshots. Nothing else was removed; try again.'

/**
 * Delete one build: its sessions (so their invite links stop working),
 * notes, screenshots and themes. Owner only, like deleting the project, and
 * in the same safe-to-press-again order: files, then child rows, then the build.
 */
const deleteBuild: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const buildId = cleanText(params.buildId, 64)
  if (!buildId) return fail('Missing build.')
  const build = await tools.get<BuildData>('builds', buildId)
  if (!build.success) return fail('Build not found.')
  const denied = await ownerOnly(tools, build.data.record.data.projectId, userId, 'a build')
  if (denied) return fail(denied)

  const notes = await tools.query<FeedbackData>('feedback', { where: { buildId } })
  if (!notes.success) return notes
  if (!(await deleteScreenshots(env, notes.data.records))) return fail(SCREENSHOT_DELETE_FAILED)

  for (const collection of ['feedback', 'themes', 'sessions']) {
    const res = await deleteAll(tools, collection, { buildId })
    if (!res.success) return res
  }
  const removed = await tools.remove('builds', buildId)
  if (!removed.success) return removed

  return ok({ buildId, notes: notes.data.records.length })
}

/**
 * Delete a project and everything in it. Only the project's owner (the dev
 * who created it) may do this; other devs on the team can't.
 *
 * Order matters: screenshots and child rows first, the team, then the
 * project itself. If anything fails halfway, the project still exists and
 * the owner can press Delete again; every step is safe to repeat.
 */
const deleteProject: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const projectId = cleanText(params.projectId, 64)
  if (!projectId) return fail('Missing project.')
  const denied = await ownerOnly(tools, projectId, userId, 'it')
  if (denied) return fail(denied)

  const notes = await tools.query<FeedbackData>('feedback', { where: { projectId } })
  if (!notes.success) return notes
  if (!(await deleteScreenshots(env, notes.data.records))) return fail(SCREENSHOT_DELETE_FAILED)

  for (const collection of ['feedback', 'themes', 'sessions', 'builds']) {
    const res = await deleteAll(tools, collection, { projectId })
    if (!res.success) return res
  }
  const team = await deleteAll(tools, 'team_members', { teamId: projectId })
  if (!team.success) return team
  const removed = await tools.remove('projects', projectId)
  if (!removed.success) return removed

  return ok({ projectId, notes: notes.data.records.length })
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

  const lock = await takeSummarizeLock(tools, projectId, buildId, userId)
  if ('busy' in lock) return fail(lock.busy)
  try {
    return await summarizeBuild(tools, env, projectId, buildId)
  } finally {
    await tools.remove('summarize_locks', lock.lockId)
  }
}

/** The summarize work itself, run while holding the build's lock. */
async function summarizeBuild(tools: ActionTools, env: Env, projectId: string, buildId: string): Promise<ActionResult> {
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

  // Replace this build's themes.
  const cleared = await deleteAll(tools, 'themes', { buildId })
  if (!cleared.success) return cleared
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

// ── Summarize lock ───────────────────────────────────────────────────────────

/** A lock older than this is left over from a crashed run and is ignored. */
const LOCK_STALE_MS = 5 * 60 * 1000

async function findLock(tools: ActionTools, buildId: string) {
  const res = await tools.query<SummarizeLockData>('summarize_locks', { where: { buildId }, limit: 1 })
  const lock = res.success ? res.data.records[0] : undefined
  return lock && Date.now() - Date.parse(lock.createdAt) < LOCK_STALE_MS ? lock : null
}

async function userName(tools: ActionTools, userId: string) {
  const res = await tools.get<{ name?: string }>('users', userId)
  return (res.success && res.data.record.data.name) || 'A teammate'
}

/**
 * Take the build's summarize lock. The record room creates rows one at a
 * time and summarize_locks allows one row per build (uniqueOn), so if two
 * devs press Summarize together exactly one create succeeds.
 */
async function takeSummarizeLock(
  tools: ActionTools,
  projectId: string,
  buildId: string,
  userId: string,
): Promise<{ lockId: string } | { busy: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await tools.create<SummarizeLockData>('summarize_locks', { projectId, buildId, userId })
    if (res.success) return { lockId: res.data.recordId }
    const held = await findLock(tools, buildId)
    if (held) {
      const who = held.data.userId === userId ? 'You are' : `${await userName(tools, held.data.userId)} is`
      return { busy: `${who} already summarizing this build. Wait for it to finish.` }
    }
    // Stale or just released. Remove only stale rows (never a fresh lock
    // another request took a moment ago), then try once more.
    const all = await tools.query<SummarizeLockData>('summarize_locks', { where: { buildId } })
    for (const old of all.success ? all.data.records : []) {
      if (Date.now() - Date.parse(old.createdAt) >= LOCK_STALE_MS) await tools.remove('summarize_locks', old.recordId)
    }
  }
  return { busy: 'Someone else is summarizing this build. Try again in a moment.' }
}

// ── Editing themes by hand ───────────────────────────────────────────────────

/** Load a theme the caller may edit, or the reason they can't. */
type Editable = { error: string } | { theme: { data: ThemeData }; id: string }

async function editableTheme(tools: ActionTools, themeId: unknown, userId: string): Promise<Editable> {
  const id = cleanText(themeId, 64)
  const theme = id ? await tools.get<ThemeData>('themes', id) : null
  if (!theme?.success) return { error: 'Theme not found.' }
  const { projectId, buildId } = theme.data.record.data
  if (!(await isTeamMember(tools, projectId, userId))) return { error: 'You are not on this project.' }
  if (await findLock(tools, buildId)) {
    return { error: 'This build is being summarized right now. Edit its themes when that finishes.' }
  }
  return { theme: theme.data.record, id: id! }
}

/** Is another theme on this build (outside `except`) already called `name`? */
async function nameTaken(tools: ActionTools, buildId: string, name: string, except: string[]) {
  const res = await tools.query<ThemeData>('themes', { where: { buildId } })
  if (!res.success) return false
  return res.data.records.some((t) => !except.includes(t.recordId) && themeKey(t.data.name) === themeKey(name))
}

/**
 * Rename a theme. Also how a dev links a theme to the previous build's one:
 * give it the same name and the compare page lines them up.
 */
const renameTheme: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const name = cleanThemeName(typeof params.name === 'string' ? params.name : '')
  if (!name) return fail('Give the theme a name.')
  const found = await editableTheme(tools, params.themeId, userId)
  if ('error' in found) return fail(found.error)
  if (await nameTaken(tools, found.theme.data.buildId, name, [found.id])) {
    return fail(`This build already has a theme called "${name}". Select both and merge them instead.`)
  }
  const res = await tools.update<ThemeData>('themes', found.id, { name })
  if (!res.success) return res
  return ok({ themeId: found.id, name })
}

/**
 * Merge two or more themes of one build into one. The first theme in the
 * list is kept (renamed, with every note); the others are deleted.
 */
const mergeThemes: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const ids = Array.isArray(params.themeIds) ? [...new Set(params.themeIds)].slice(0, 50) : []
  if (ids.length < 2) return fail('Pick at least two themes to merge.')
  const name = cleanThemeName(typeof params.name === 'string' ? params.name : '')
  if (!name) return fail('Give the merged theme a name.')

  const themes: { theme: { data: ThemeData }; id: string }[] = []
  for (const id of ids) {
    const found = await editableTheme(tools, id, userId)
    if ('error' in found) return fail(found.error)
    themes.push(found)
  }
  const buildId = themes[0].theme.data.buildId
  if (themes.some((t) => t.theme.data.buildId !== buildId)) return fail('Only themes from the same build can be merged.')
  if (await nameTaken(tools, buildId, name, themes.map((t) => t.id))) {
    return fail(`This build already has another theme called "${name}". Include it in the merge, or pick another name.`)
  }

  const [keep, ...rest] = themes
  const merged = combineThemes(themes.map((t) => t.theme.data))
  const res = await tools.update<ThemeData>('themes', keep.id, { name, ...merged, count: merged.feedbackIds.length })
  if (!res.success) return res
  for (const t of rest) {
    const removed = await tools.remove('themes', t.id)
    if (!removed.success) return removed
  }
  return ok({ themeId: keep.id, count: merged.feedbackIds.length })
}

export const actions: Record<string, ActionHandler<Env>> = {
  summarizeSession,
  renameTheme,
  mergeThemes,
  transferOwnership,
  createProject,
  createDemoProject,
  deleteProject,
  deleteBuild,
  addTeammate,
  removeTeammate,
  addBuild,
  openSession,
  closeSession,
  joinSession,
  submitFeedback,
}
