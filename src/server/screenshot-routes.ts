/**
 * GET /api/screenshots/:feedbackId: serve a note's screenshot from the private
 * bucket, but only to the tester who wrote the note or the project's team.
 *
 * "Not allowed" and "doesn't exist" both answer 404, so an outsider can't
 * even learn which notes have screenshots.
 */

import type { Hono } from 'hono'
import type { VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'
import type { FeedbackData } from '../schemas/playtest-schemas'
import { createActionTools } from './action-routes.js'
import { canReadFeedback } from './access.js'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>

export function registerScreenshotRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.get('/api/screenshots/:feedbackId', async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const notFound = () => c.json({ error: 'not_found' }, 404)

    const tools = createActionTools(c.env, auth.userId, '')
    const feedback = await tools.get<FeedbackData>('feedback', c.req.param('feedbackId'))
    if (!feedback.success) return notFound()
    const note = feedback.data.record.data
    if (!note.screenshotKey || !(await canReadFeedback(tools, note, auth.userId))) return notFound()

    const object = await c.env.SCREENSHOTS.get(note.screenshotKey)
    if (!object) return notFound()
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
