/**
 * Playtest Lab collections.
 *
 * Access model (enforced by the server, in the record room):
 * - Every row carries the id of the project it belongs to (`teamField`).
 * - A user can read a row if they are on that project's team (an active
 *   row in `team_members` with teamId = projectId), or if they own it.
 * - Nobody creates rows from the browser (`create: false`). Every create goes
 *   through a server action in src/actions/ that checks membership first.
 * - Testers are never team members. They only see their own feedback,
 *   because feedback's owner is `testerId`.
 */

import type { CollectionSchema, PermissionLevel, RolePermissions } from 'deepspace/schema'

/** Same rule for every signed-in role. Signed-out visitors get nothing. */
function teamRule(update: PermissionLevel, writableFields?: string[]) {
  const rule: RolePermissions = {
    read: 'team',
    create: false,
    update,
    delete: false,
    ...(writableFields ? { writableFields } : {}),
  }
  return { member: rule, admin: rule }
}

const text = (name: string) => ({ name, storage: 'text', interpretation: 'plain' }) as const

export const projectsSchema: CollectionSchema = {
  name: 'projects',
  // teamId is the project's own id, so the 'team' rule can find the team.
  columns: [text('name'), { ...text('teamId'), immutable: true }],
  teamField: 'teamId',
  permissions: teamRule('team', ['name']),
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
  permissions: teamRule('team', ['changelog']),
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
  ],
  teamField: 'projectId',
  // 'team' = owner OR team member. The owner is the tester, not the creator.
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
  permissions: teamRule(false),
}

export const playtestSchemas = [
  projectsSchema,
  teamMembersSchema,
  buildsSchema,
  sessionsSchema,
  feedbackSchema,
  themesSchema,
]
