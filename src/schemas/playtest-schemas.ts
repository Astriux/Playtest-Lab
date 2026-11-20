/**
 * Playtest Lab collections.
 *
 * Access model (enforced by the server, in the record room):
 * - Every row carries the id of the project it belongs to (`teamField`).
 * - A user can read a row if they are on that project's team (an active
 *   row in `team_members` with teamId = projectId), or if they own it
 *   (`ownerField`: a project's current owner, a note's tester).
 * - We use the 'access' level, not 'team'. They mean the same thing, but for
 *   'team' DeepSpace's list queries also let whoever CREATED a row read it
 *   forever, ignoring ownerField. With 'access' every row is checked against
 *   the rule above, so a dev who leaves loses the builds and themes they
 *   made too (see NOTES.md, "Removed devs kept rows they created").
 * - Nobody creates rows from the browser (`create: false`). Every create goes
 *   through a server action in src/actions/ that checks membership first.
 * - Testers are never team members. They only see their own feedback,
 *   because feedback's owner is `testerId`.
 */

import type { CollectionSchema, PermissionLevel, RolePermissions } from 'deepspace/schema'

/** Same rule for every signed-in role. Signed-out visitors get nothing. */
function teamRule(update: PermissionLevel, writableFields?: string[]) {
  const rule: RolePermissions = {
    read: 'access',
    create: false,
    update,
    delete: false,
    ...(writableFields ? { writableFields } : {}),
  }
  return { member: rule, admin: rule }
}

const text = (name: string) => ({ name, storage: 'text', interpretation: 'plain' }) as const

/**
 * Nobody owns a build, session or theme personally; access comes only from
 * the team. ownerField points at projectId, which is never a user id, so no
 * single user counts as the owner.
 */
const NO_PERSONAL_OWNER = 'projectId'

export const projectsSchema: CollectionSchema = {
  name: 'projects',
  // teamId is the project's own id, so the team rule can find the team.
  // ownerId is the owner, who can hand the project to another dev. Only the
  // transferOwnership action changes it; the browser may write only 'name'.
  columns: [text('name'), { ...text('teamId'), immutable: true }, text('ownerId')],
  teamField: 'teamId',
  ownerField: 'ownerId',
  permissions: teamRule('access', ['name']),
}

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { ...text('teamId'), required: true, immutable: true },
    { ...text('userId'), required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active', 'removed'] } },
  ],
  uniqueOn: ['teamId', 'userId'],
  teamField: 'teamId',
  ownerField: 'userId',
  // Read-only from the browser. Only server actions add or remove devs,
  // otherwise anyone could add themselves to any team.
  permissions: teamRule(false),
}

export const buildsSchema: CollectionSchema = {
  name: 'builds',
  columns: [
    { ...text('projectId'), required: true, immutable: true },
    { ...text('version'), required: true },
    text('changelog'),
  ],
  teamField: 'projectId',
  ownerField: NO_PERSONAL_OWNER,
  permissions: teamRule('access', ['changelog']),
}

export const sessionsSchema: CollectionSchema = {
  name: 'sessions',
  columns: [
    { ...text('projectId'), required: true, immutable: true },
    { ...text('buildId'), required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['open', 'closed'] } },
    { ...text('inviteCode'), required: true, immutable: true },
  ],
  uniqueOn: ['inviteCode'],
  teamField: 'projectId',
  ownerField: NO_PERSONAL_OWNER,
  permissions: teamRule(false),
}

export const TAGS = ['bug', 'balance', 'confusing', 'fun'] as const
export type Tag = (typeof TAGS)[number]

export const feedbackSchema: CollectionSchema = {
  name: 'feedback',
  columns: [
    { ...text('projectId'), required: true, immutable: true },
    { ...text('buildId'), required: true, immutable: true },
    { ...text('sessionId'), required: true, immutable: true },
    { ...text('testerId'), required: true, immutable: true },
    { name: 'tag', storage: 'text', interpretation: { kind: 'select', options: [...TAGS] } },
    { ...text('text'), required: true },
    text('screenshotKey'),
    // Optional link to a gameplay clip hosted elsewhere (Medal, YouTube…).
    { name: 'clipUrl', storage: 'text', interpretation: { kind: 'url' } },
  ],
  teamField: 'projectId',
  // Readable by its owner (the tester, not whoever created the row) or the team.
  ownerField: 'testerId',
  permissions: teamRule(false),
}

export const themesSchema: CollectionSchema = {
  name: 'themes',
  columns: [
    { ...text('projectId'), required: true, immutable: true },
    { ...text('buildId'), required: true, immutable: true },
    { ...text('name'), required: true },
    text('summary'),
    { name: 'count', storage: 'number', interpretation: 'plain' },
    { name: 'feedbackIds', storage: 'text', interpretation: { kind: 'json' } },
  ],
  teamField: 'projectId',
  ownerField: NO_PERSONAL_OWNER,
  permissions: teamRule(false),
}

/**
 * "Someone is summarizing this build." One row per build at most (uniqueOn),
 * so when two devs press Summarize together, the record room lets exactly one
 * create its row and the other gets a clear "already running" answer.
 * The team can read it, so the panel can say who is summarizing.
 */
export const summarizeLocksSchema: CollectionSchema = {
  name: 'summarize_locks',
  columns: [
    { ...text('projectId'), required: true, immutable: true },
    { ...text('buildId'), required: true, immutable: true },
    { ...text('userId'), required: true, immutable: true },
  ],
  uniqueOn: ['buildId'],
  teamField: 'projectId',
  ownerField: NO_PERSONAL_OWNER,
  permissions: teamRule(false),
}

/** The shape of each record's `data`, for TypeScript on both sides. */
/** ownerId is missing on projects made before ownership could be handed over. */
export type ProjectData = { name: string; teamId: string; ownerId?: string }

/** The project's owner: ownerId, or for older projects whoever created it. */
export function projectOwnerId(project: { data: ProjectData; createdBy: string }): string {
  return project.data.ownerId || project.createdBy
}
export type TeamMemberData = { teamId: string; userId: string; status: 'active' | 'removed' }
export type BuildData = { projectId: string; version: string; changelog: string }
export type SessionData = {
  projectId: string
  buildId: string
  status: 'open' | 'closed'
  inviteCode: string
}
export type FeedbackData = {
  projectId: string
  buildId: string
  sessionId: string
  testerId: string
  tag: Tag
  text: string
  screenshotKey: string
  /** '' or missing when there's no clip (older notes predate this field). */
  clipUrl?: string
}
export type ThemeData = {
  projectId: string
  buildId: string
  name: string
  summary: string
  count: number
  feedbackIds: string[]
}
export type SummarizeLockData = { projectId: string; buildId: string; userId: string }

export const playtestSchemas = [
  projectsSchema,
  teamMembersSchema,
  buildsSchema,
  sessionsSchema,
  feedbackSchema,
  themesSchema,
  summarizeLocksSchema,
]
