/**
 * Permission proof: 2 authorized users + 1 outsider, checked at the server,
 * not just in the UI.
 *
 *   Ava  (dev, on the team)    should see everything in the project
 *   Ben  (tester, invite link) should see only his own notes
 *   Cy   (outsider)            should see nothing
 *
 * 1. We record every WebSocket message the server sends each user while they
 *    open the project, session and invite pages. That is exactly the data
 *    their browser received, whatever the UI chose to show.
 * 2. We call server actions and the screenshot route directly as Ben and Cy,
 *    the way someone bypassing the UI would.
 */
import { test, expect, type MultiplayerUser } from 'deepspace/testing'

// A real 1x1 PNG, so the server's file-type check accepts it.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

type ActionResponse = { status: number; body: { success: boolean; data?: Record<string, string>; error?: string } }

/** Call a server action as this user, from inside their signed-in browser. */
function act(user: MultiplayerUser, name: string, params: Record<string, unknown>): Promise<ActionResponse> {
  return user.page.evaluate(
    async ([name, params]) => {
      const { token } = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }).then((r) => r.json())
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return { status: res.status, body: await res.json() }
    },
    [name, params] as const,
  )
}

/** Fetch a screenshot as this user; returns the HTTP status and content type. */
function getShot(user: MultiplayerUser, feedbackId: string, withToken = true) {
  return user.page.evaluate(
    async ([feedbackId, withToken]) => {
      const { token } = await fetch('/api/auth/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }).then((r) => r.json())
      const res = await fetch(`/api/screenshots/${feedbackId}`, {
        headers: withToken ? { Authorization: `Bearer ${token}` } : {},
      })
      return { status: res.status, type: res.headers.get('content-type') }
    },
    [feedbackId, withToken] as const,
  )
}

/** Collect the text of every WebSocket message the server sends this page. */
function recordFrames(user: MultiplayerUser): string[] {
  const frames: string[] = []
  user.page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => frames.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8')))
  })
  return frames
}

test('dev sees all, tester sees only their own, outsider sees nothing', async ({ users }) => {
  test.setTimeout(180_000)
  const [ava, ben, cy] = await users(['Ava (dev)', 'Ben (tester)', 'Cy (outsider)'])
  const run = Date.now().toString(36)
  const SECRET_PROJECT = `Secret project ${run}`
  const SECRET_VERSION = `v-secret-${run}`
  const BEN_NOTE = `ben-private-note-${run}`
  const AVA_NOTE = `ava-private-note-${run}`

  const frames = { ava: recordFrames(ava), ben: recordFrames(ben), cy: recordFrames(cy) }
  for (const u of [ava, ben, cy]) {
    await u.page.goto('/home')
    await expect(u.page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 15_000 })
  }

  // ── Setup by the dev ──────────────────────────────────────────────────────
  const project = await act(ava, 'createProject', { name: SECRET_PROJECT })
  const projectId = project.body.data!.projectId
  const build = await act(ava, 'addBuild', { projectId, version: SECRET_VERSION, changelog: '' })
  const buildId = build.body.data!.buildId
  const session = await act(ava, 'openSession', { buildId })
  const { sessionId, inviteCode } = session.body.data!

  // ── Ben submits a note and tries to spoof who and where it belongs to ─────
  const benNote = await act(ben, 'submitFeedback', {
    inviteCode,
    tag: 'bug',
    text: BEN_NOTE,
    screenshot: PNG_1PX,
    testerId: ava.userId ?? 'someone-else',
    projectId: 'some-other-project',
  })
  expect(benNote.body.success).toBe(true)
  const benNoteId = benNote.body.data!.feedbackId

  // Ava leaves a note through the same link, so Ben has someone else's note to (not) see.
  expect((await act(ava, 'submitFeedback', { inviteCode, tag: 'fun', text: AVA_NOTE })).body.success).toBe(true)

  // Something that isn't an image is refused, whatever the client calls it.
  const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  const badShot = await act(ben, 'submitFeedback', { inviteCode, tag: 'bug', text: 'svg', screenshot: svg })
  expect(badShot.body.success).toBe(false)

  // Clip links that could run code or skip https are refused.
  for (const clipUrl of ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>', 'http://example.com/clip']) {
    const res = await act(ben, 'submitFeedback', { inviteCode, tag: 'bug', text: 'clip', clipUrl })
    expect(res.body, clipUrl).toMatchObject({ success: false })
  }

  // ── Everyone opens every page, so the server is asked for everything ─────
  for (const u of [ava, ben, cy]) {
    for (const path of [`/projects/${projectId}`, `/sessions/${sessionId}`, `/join/${inviteCode}`]) {
      await u.page.goto(path)
      await u.page.waitForTimeout(1500)
    }
  }
  await ava.page.goto(`/sessions/${sessionId}`)
  await expect(ava.page.getByText(BEN_NOTE)).toBeVisible({ timeout: 15_000 })

  // ── 1. What the server actually sent over the WebSocket ───────────────────
  const sent = (who: keyof typeof frames, text: string) => frames[who].some((f) => f.includes(text))

  // Positive control: the recording works, and the dev receives everything.
  expect(sent('ava', SECRET_PROJECT)).toBe(true)
  expect(sent('ava', BEN_NOTE)).toBe(true)
  expect(sent('ava', AVA_NOTE)).toBe(true)

  // The tester receives his own note and nothing else from the project.
  expect(sent('ben', BEN_NOTE)).toBe(true)
  expect(sent('ben', AVA_NOTE)).toBe(false)
  expect(sent('ben', SECRET_PROJECT)).toBe(false)
  expect(sent('ben', SECRET_VERSION)).toBe(false)

  // The outsider receives nothing at all from the project.
  for (const secret of [SECRET_PROJECT, SECRET_VERSION, BEN_NOTE, AVA_NOTE]) {
    expect(sent('cy', secret), `outsider received "${secret}"`).toBe(false)
  }

  // ── 2. Server actions refuse non-members ──────────────────────────────────
  for (const u of [ben, cy]) {
    const attempts = [
      act(u, 'addBuild', { projectId, version: 'hijack' }),
      act(u, 'openSession', { buildId }),
      act(u, 'closeSession', { sessionId }),
      act(u, 'addTeammate', { projectId, email: u.email }),
    ]
    for (const res of await Promise.all(attempts)) {
      expect(res.body).toMatchObject({ success: false, error: 'You are not on this project.' })
    }
  }

  // ── 3. Screenshots: tester and team yes, outsider no, signed-out no ──────
  // Ben getting his own screenshot also proves the spoofed testerId was
  // ignored: if the note had been saved as Ava's, Ben would get a 404.
  expect(await getShot(ava, benNoteId)).toEqual({ status: 200, type: 'image/png' })
  expect((await getShot(ben, benNoteId)).status).toBe(200)
  expect((await getShot(cy, benNoteId)).status).toBe(404)
  expect((await getShot(cy, benNoteId, false)).status).toBe(401)

  // The file sits in Ben's private folder of the built-in storage. Even with
  // its exact key, the built-in /api/files route serves it to Ben only, so
  // the team's only way in is our checked route above.
  const key = frames.ava.join('\n').match(new RegExp(`apps/[^"\\\\]*screenshots/${benNoteId}`))?.[0]
  expect(key, 'screenshot key in the dev data').toBeTruthy()
  const direct = (u: MultiplayerUser) =>
    u.page.evaluate(async (k) => (await fetch(`/api/files/${k}?scope=self`)).status, key!)
  expect(await direct(ben)).toBe(200)
  expect(await direct(ava)).not.toBe(200)
  expect(await direct(cy)).not.toBe(200)

  // ── 4. Adding Cy to the team grants access ───────────────────────────────
  await cy.page.goto(`/projects/${projectId}`)
  await expect(cy.page.getByRole('heading', { name: 'Project not found' })).toBeVisible({ timeout: 15_000 })
  expect((await act(ava, 'addTeammate', { projectId, email: cy.email })).body.success).toBe(true)

  // Does the open page update by itself? Recorded, not required (see NOTES.md).
  const liveUpdate = await cy.page
    .getByRole('heading', { name: SECRET_PROJECT })
    .waitFor({ timeout: 8_000 })
    .then(() => true, () => false)
  test.info().annotations.push({ type: 'membership-live-update', description: String(liveUpdate) })
  console.log(`membership-live-update: ${liveUpdate}`)

  await cy.page.reload()
  await expect(cy.page.getByRole('heading', { name: SECRET_PROJECT })).toBeVisible({ timeout: 15_000 })
  expect((await getShot(cy, benNoteId)).status).toBe(200)

  // ── 5. Deleting and removing people is the owner's job ───────────────────
  // Cy is a dev now, but not the owner (Ava created it): no delete or remove
  // controls on his page, and the server refuses each one.
  await expect(cy.page.getByRole('heading', { name: 'Delete project' })).toHaveCount(0)
  await expect(cy.page.getByRole('button', { name: 'Delete build…' })).toHaveCount(0)
  await expect(cy.page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
  const refusals: [MultiplayerUser, string, Record<string, unknown>, string][] = [
    [cy, 'deleteProject', { projectId }, 'Only the project owner can delete it.'],
    [cy, 'deleteBuild', { buildId }, 'Only the project owner can delete a build.'],
    [cy, 'removeTeammate', { projectId, userId: ava.userId }, "The owner can't be removed. Delete the project instead."],
    [ben, 'deleteProject', { projectId }, 'You are not on this project.'],
    [ben, 'deleteBuild', { buildId }, 'You are not on this project.'],
    [ben, 'removeTeammate', { projectId, userId: cy.userId }, 'You are not on this project.'],
  ]
  for (const [u, name, params, error] of refusals) {
    expect((await act(u, name, params)).body, name).toMatchObject({ success: false, error })
  }

  // ── 6. Deleting one build removes only that build ────────────────────────
  const doomedBuild = (await act(ava, 'addBuild', { projectId, version: `v-doomed-${run}` })).body.data!.buildId
  const doomedInvite = (await act(ava, 'openSession', { buildId: doomedBuild })).body.data!.inviteCode
  const doomedNote = await act(ben, 'submitFeedback', { inviteCode: doomedInvite, tag: 'bug', text: 'doomed', screenshot: PNG_1PX })
  const doomedNoteId = doomedNote.body.data!.feedbackId
  expect((await getShot(ava, doomedNoteId)).status).toBe(200)

  expect((await act(ava, 'deleteBuild', { buildId: doomedBuild })).body.success).toBe(true)
  expect((await getShot(ava, doomedNoteId)).status).toBe(404)
  expect((await act(ben, 'joinSession', { inviteCode: doomedInvite })).body.error).toBe('This invite link is not valid.')
  // The other build, its invite link and Ben's first note are untouched.
  expect((await act(ben, 'joinSession', { inviteCode })).body.success).toBe(true)
  expect((await getShot(ava, benNoteId)).status).toBe(200)

  // ── 7. Leaving, and being removed, take access away ──────────────────────
  // A dev who isn't the owner can leave; Ava adds Cy back for the next check.
  expect((await act(cy, 'removeTeammate', { projectId, userId: cy.userId })).body.success).toBe(true)
  expect((await act(cy, 'addBuild', { projectId, version: 'after-leaving' })).body.error).toBe('You are not on this project.')
  expect((await act(ava, 'addTeammate', { projectId, email: cy.email })).body.success).toBe(true)

  // Cy watches the project page. Positive control: he receives a new build live.
  await cy.page.goto(`/projects/${projectId}`)
  await expect(cy.page.getByRole('heading', { name: SECRET_PROJECT })).toBeVisible({ timeout: 15_000 })
  const BEFORE = `v-before-removal-${run}`
  await act(ava, 'addBuild', { projectId, version: BEFORE })
  await expect(cy.page.getByText(BEFORE, { exact: true })).toBeVisible({ timeout: 15_000 })

  // Ava removes him through the UI, while his page is still open.
  await ava.page.goto(`/projects/${projectId}`)
  await ava.page.getByRole('button', { name: /^Remove / }).click()
  await ava.page.getByRole('button', { name: 'Yes, remove' }).click()
  await expect(ava.page.getByRole('button', { name: /^Remove / })).toHaveCount(0, { timeout: 15_000 })

  // The server stops sending him anything new, even on the page he had open.
  const AFTER = `v-after-removal-${run}`
  await act(ava, 'addBuild', { projectId, version: AFTER })
  await expect(ava.page.getByText(AFTER, { exact: true })).toBeVisible({ timeout: 15_000 })
  await cy.page.waitForTimeout(2000)
  expect(sent('cy', AFTER), 'removed teammate received a new build').toBe(false)

  await cy.page.reload()
  await expect(cy.page.getByRole('heading', { name: 'Project not found' })).toBeVisible({ timeout: 15_000 })
  expect((await getShot(cy, benNoteId)).status).toBe(404)

  // ── 8. The owner deletes the whole project ───────────────────────────────
  expect((await act(ava, 'deleteProject', { projectId })).body.success).toBe(true)

  // Everything is gone: the project, the invite link, and the screenshot file itself.
  await ava.page.goto(`/projects/${projectId}`)
  await expect(ava.page.getByRole('heading', { name: 'Project not found' })).toBeVisible({ timeout: 15_000 })
  expect((await act(ben, 'joinSession', { inviteCode })).body.error).toBe('This invite link is not valid.')
  expect((await getShot(ava, benNoteId)).status).toBe(404)
  expect(await direct(ben)).not.toBe(200)
})
