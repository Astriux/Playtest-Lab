/**
 * Real AI test: summarize two builds and check theme names carry over.
 * Calls Claude (costs DeepSpace credits), so it only runs when asked:
 *   RUN_AI_TESTS=1 npx deepspace test run tests/summarize.spec.ts
 */
import { test, expect, type MultiplayerUser } from 'deepspace/testing'
import { V04_NOTES, V05_NOTES, type FixtureNote } from './fixtures/tower-defense'

test.skip(!process.env.RUN_AI_TESTS, 'Set RUN_AI_TESTS=1 to run tests that call Claude.')

type Result = { success: boolean; data?: Record<string, string & number>; error?: string }

function act(user: MultiplayerUser, name: string, params: Record<string, unknown>): Promise<Result> {
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
      return res.json()
    },
    [name, params] as const,
  )
}

/**
 * Run one playtest. Notes are spread over the tester accounts the way the
 * demo spreads them over its made-up testers, because the compare page
 * measures themes by how many testers raised them.
 */
async function playtest(dev: MultiplayerUser, testers: MultiplayerUser[], projectId: string, version: string, notes: FixtureNote[]) {
  const tester = testers[0]
  const build = await act(dev, 'addBuild', { projectId, version, changelog: '' })
  const session = await act(dev, 'openSession', { buildId: build.data!.buildId })
  const { sessionId, inviteCode } = session.data!
  for (const { tester: n, ...note } of notes) {
    expect((await act(testers[n % testers.length], 'submitFeedback', { inviteCode, ...note })).success).toBe(true)
  }
  // Summarizing an open session is refused.
  expect((await act(dev, 'summarizeSession', { sessionId })).error).toMatch(/End the session first/)
  await act(dev, 'closeSession', { sessionId })
  // Testers can't trigger (and spend credits on) a summary.
  expect((await act(tester, 'summarizeSession', { sessionId })).error).toBe('You are not on this project.')
  const summary = await act(dev, 'summarizeSession', { sessionId })
  expect(summary, JSON.stringify(summary)).toMatchObject({ success: true })
  return { sessionId, ...summary.data! }
}

test('themes keep their names from one build to the next', async ({ users }) => {
  test.setTimeout(240_000)
  const [dev, ben, cy] = await users(['Ava (dev)', 'Ben (tester)', 'Cy (outsider)'])
  for (const u of [dev, ben, cy]) await u.page.goto('/home')
  const testers = [ben, cy]

  const project = await act(dev, 'createProject', { name: `AI test ${Date.now().toString(36)}` })
  const projectId = project.data!.projectId

  const v04 = await playtest(dev, testers, projectId, 'v0.4', V04_NOTES)
  expect(v04.noteCount).toBe(V04_NOTES.length)
  expect(v04.themeCount).toBeGreaterThanOrEqual(4)

  const v05 = await playtest(dev, testers, projectId, 'v0.5', V05_NOTES)
  // Wave 7, tower placement and boss music are the same issues in both builds.
  expect(v05.matchedPrevious).toBeGreaterThanOrEqual(2)

  console.log(`AI summary: v0.4 ${v04.themeCount} themes, v0.5 ${v05.themeCount} themes, ${v05.matchedPrevious} reused names`)

  // Two Summarize presses at the same moment: exactly one runs, the other is
  // told to wait (the summarize_locks row, one per build).
  const twice = await Promise.all([
    act(dev, 'summarizeSession', { sessionId: v05.sessionId }),
    act(dev, 'summarizeSession', { sessionId: v05.sessionId }),
  ])
  expect(twice.filter((r) => r.success), JSON.stringify(twice)).toHaveLength(1)
  expect(twice.find((r) => !r.success)?.error).toMatch(/already summarizing this build/)

  // The session page lists the build's themes.
  const shots = process.env.SHOTS_DIR
  await dev.page.setViewportSize({ width: 1200, height: 1000 })
  await dev.page.goto(`/sessions/${v05.sessionId}`)
  await expect(dev.page.getByRole('heading', { name: /Themes for/ })).toBeVisible({ timeout: 15_000 })
  await expect(dev.page.getByRole('button', { name: 'Re-summarize' })).toBeVisible()
  if (shots) await dev.page.screenshot({ path: `${shots}/themes-panel.png`, fullPage: true })

  // The compare page shows the wave 7 theme going down from v0.4 to v0.5.
  await dev.page.goto(`/projects/${projectId}/compare`)
  await expect(dev.page.getByRole('heading', { name: 'Did the fix work?' })).toBeVisible({ timeout: 15_000 })
  const wave7 = dev.page.locator('li').filter({ hasText: /wave 7/i }).first()
  // Both testers hit wave 7 on v0.4; only one did on v0.5: 100% → 50%.
  await expect(wave7).toContainText('▼ 50 pts')
  await wave7.locator('summary').click()
  await expect(wave7).toContainText('Wave 7 wiped me out three times in a row')
  if (shots) await dev.page.screenshot({ path: `${shots}/compare.png`, fullPage: true })
})
