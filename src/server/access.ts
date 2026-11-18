/**
 * Access checks shared by server actions and worker routes. Both use tools
 * that skip collection permissions, so they must call these themselves.
 */

import type { ActionTools } from 'deepspace/worker'
import type { FeedbackData } from '../schemas/playtest-schemas'

/** Same rule the 'team' permission level uses: an active team_members row. */
export async function isTeamMember(tools: ActionTools, projectId: string, userId: string) {
  const res = await tools.query('team_members', {
    where: { teamId: projectId, userId, status: 'active' },
    limit: 1,
  })
  return res.success && res.data.records.length > 0
}

/** A note is visible to the tester who wrote it and to the project's team. */
export async function canReadFeedback(tools: ActionTools, feedback: FeedbackData, userId: string) {
  return feedback.testerId === userId || (await isTeamMember(tools, feedback.projectId, userId))
}
