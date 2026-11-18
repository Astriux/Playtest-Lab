/**
 * GET /api/screenshots/:feedbackId: serve a note's screenshot, but only to
 * the tester who wrote the note or the project's team.
 *
 * Screenshots live in the tester's private ('self') folder in DeepSpace's
 * built-in file storage. After our own access check, the worker reads that
 * folder as the app, using the testerId stored on the note (which the
 * server set, so it's trustworthy, not request input).
 *
 * "Not allowed" and "doesn't exist" both answer 404, so an outsider can't
 * even learn which notes have screenshots.
 */

import type { Hono } from 'hono'
import { appFiles, AppFileError } from 'deepspace/worker'
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

    let file: Response
    try {
      file = await appFiles(c.env, { scope: 'self', userId: note.testerId }).download(note.screenshotKey)
    } catch (err) {
      if (err instanceof AppFileError && err.status === 404) return notFound()
      throw err
    }
    return new Response(file.body, {
      headers: {
        'Content-Type': file.headers.get('Content-Type') ?? 'application/octet-stream',
        // Never let the browser keep a copy: every view must pass the access
        // check, so a deleted project's screenshots can't be re-shown from cache.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
