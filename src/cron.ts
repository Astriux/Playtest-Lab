/**
 * Scheduled tasks, run by AppCronRoom (worker.ts) on the schedule below.
 *
 * end-stale-sessions: a dev who forgets to press "End session" would leave
 * the invite link working forever. Every hour, any session still open 24
 * hours after it started is ended, the same as pressing the button.
 */

import type { CronTask } from 'deepspace/worker'
import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { staleSessionIds } from './lib/sessions'

export const tasks: CronTask[] = [{ name: 'end-stale-sessions', intervalMinutes: 60 }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'end-stale-sessions') return
  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const open = (await ctx.records.query('sessions', { where: { status: 'open' } })) as {
    recordId: string
    createdAt: string
  }[]
  const stale = staleSessionIds(open, Date.now())
  for (const id of stale) await ctx.records.update('sessions', id, { status: 'closed' })
  if (stale.length > 0) console.info(`[cron] ended ${stale.length} stale session(s)`)
}
