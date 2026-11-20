/**
 * The demo project: one click gives a project whose compare page tells the
 * intended story (a fix that worked, a bug that's gone, a fix that didn't).
 */
import { test, expect, type MultiplayerUser } from 'deepspace/testing'

/** Call a server action as this user, from inside their signed-in browser. */
function act(user: MultiplayerUser, name: string, params: Record<string, unknown>) {
  return user.page.evaluate(
    async ([name, params]) => {
      const { token } = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' }).then((r) => r.json())
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return (await res.json()) as { success: boolean; error?: string }
    },
    [name, params] as const,
  )
}

test('demo project shows a full build comparison', async ({ users }) => {
  test.setTimeout(150_000)
  const [dev, outsider] = await users(['Ava (dev)', 'Cy (outsider)'])
  await outsider.page.goto('/home')
  await dev.page.goto('/home')
  await dev.page.getByRole('button', { name: /Try the demo|Explore a demo project/ }).click()
  await expect(dev.page.getByRole('heading', { name: 'Tower Defense (demo)' })).toBeVisible({ timeout: 30_000 })

  // Three builds; the newest has a live session to try the tester flow.
  for (const v of ['v0.4', 'v0.5', 'v0.6']) await expect(dev.page.getByText(v, { exact: true })).toBeVisible()
  await expect(dev.page.getByText('Live session')).toBeVisible()

  await dev.page.getByRole('link', { name: 'Compare builds' }).click()
  await expect(dev.page.getByRole('heading', { name: 'Did the fix work?' })).toBeVisible({ timeout: 15_000 })
  await expect(dev.page.getByText('15 notes from 4 testers')).toBeVisible()

  const row = (name: string) => dev.page.locator('li').filter({ hasText: name }).first()
  // Measured in testers: wave 7 went from 4 of 4 testers to 1 of 4.
  await expect(row('Wave 7 too hard')).toContainText('▼ 75 pts')
  await expect(row('Wave 7 too hard')).toContainText('100%')
  await expect(row('Wave 7 too hard')).toContainText('25%')
  await expect(row('Crash when selling towers')).toContainText('Gone')
  await expect(row("Can't tell where towers go")).toContainText('▲ 25 pts')
  await expect(row('Wave 12 boss too tanky')).toContainText('New')

  // Opening a theme shows its notes and who wrote them.
  await row('Wave 7 too hard').locator('summary').click()
  await expect(row('Wave 7 too hard')).toContainText('The flyers in wave 7 shred everything')
  await expect(row('Wave 7 too hard')).toContainText('Demo tester 4')
  await expect(row('Wave 7 too hard')).toContainText('v0.4 · 4 testers · 6 notes')

  // ── Fix the AI's grouping by hand on v0.5 ─────────────────────────────────
  await dev.page.getByRole('link', { name: /Tower Defense \(demo\)/ }).click()
  const v05 = dev.page.locator('li').filter({ hasText: 'v0.5' }).first()
  await v05.getByRole('link', { name: /Session/ }).click()
  await expect(dev.page.getByRole('heading', { name: /Themes for/ })).toBeVisible({ timeout: 15_000 })
  await dev.page.getByRole('button', { name: 'Edit themes' }).click()

  // An outsider can't edit themes, even with a real theme id.
  const themeId = await dev.page.locator('[data-theme-id]').first().getAttribute('data-theme-id')
  expect(await act(outsider, 'renameTheme', { themeId, name: 'hijacked' })).toMatchObject({
    success: false,
    error: 'You are not on this project.',
  })

  // Rename: refused when the name is taken on this build, works otherwise.
  const nameBox = (name: string) => dev.page.getByLabel(`Name of theme ${name}`, { exact: true })
  const renameRow = (name: string) => dev.page.locator('li[data-theme-id]').filter({ has: nameBox(name) })
  await nameBox('Pause menu fails with controller').fill('Wave 7 too hard')
  await renameRow('Pause menu fails with controller').getByRole('button', { name: 'Rename' }).click()
  await expect(dev.page.getByText('This build already has a theme called "Wave 7 too hard"')).toBeVisible()
  await nameBox('Pause menu fails with controller').fill('Controller support')
  await renameRow('Pause menu fails with controller').getByRole('button', { name: 'Rename' }).click()
  await expect(nameBox('Controller support')).toBeVisible({ timeout: 15_000 })

  // Merge: the two tower-praise themes become one.
  await dev.page.getByRole('checkbox', { name: 'Select New ice tower is satisfying to merge' }).check()
  await dev.page.getByRole('button', { name: 'Merge' }).click()
  await expect(dev.page.getByText('Tick at least two themes to merge.')).toBeVisible()
  await dev.page.getByRole('checkbox', { name: 'Select Love the chain-lightning tower to merge' }).check()
  await dev.page.getByLabel('Merge 2 themes into').fill('Towers feel great')
  await dev.page.getByRole('button', { name: 'Merge' }).click()
  await expect(nameBox('Towers feel great')).toBeVisible({ timeout: 15_000 })
  await expect(nameBox('Love the chain-lightning tower')).toHaveCount(0)
  await dev.page.getByRole('button', { name: 'Done editing' }).click()
  const merged = dev.page.locator('li').filter({ hasText: 'Towers feel great' }).first()
  await expect(merged).toContainText('2')

  // The compare page follows the edits: a new merged theme, the old name gone.
  await dev.page.getByRole('link', { name: 'Compare builds' }).click()
  await expect(dev.page.getByRole('heading', { name: 'Did the fix work?' })).toBeVisible({ timeout: 15_000 })
  await expect(row('Towers feel great')).toContainText('New')
  await expect(row('Love the chain-lightning tower')).toContainText('Gone')
  await expect(row('Controller support')).toContainText('New')

  // The owner can delete a single build: v0.6 and its live session go.
  await dev.page.getByRole('link', { name: /Tower Defense \(demo\)/ }).click()
  const projectUrl = new URL(dev.page.url()).pathname
  const v06 = dev.page.locator('li').filter({ hasText: 'v0.6' }).first()
  await v06.getByRole('button', { name: 'Delete build…' }).click()
  await expect(dev.page.getByText('This permanently removes 1 session and 0 notes')).toBeVisible()
  await dev.page.getByRole('button', { name: 'Delete build', exact: true }).click()
  await expect(dev.page.getByText('v0.6', { exact: true })).toHaveCount(0, { timeout: 15_000 })
  await expect(dev.page.getByText('Live session')).toHaveCount(0)
  await expect(dev.page.getByText('v0.5', { exact: true })).toBeVisible()

  // The owner can delete the whole project; the name must be typed to confirm.
  await dev.page.getByRole('button', { name: 'Delete project…' }).click()
  await dev.page.getByLabel('Type the project name to confirm').fill('wrong name')
  await dev.page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(dev.page.getByText('Type "Tower Defense (demo)" exactly to confirm.')).toBeVisible()
  await dev.page.getByLabel('Type the project name to confirm').fill('Tower Defense (demo)')
  await dev.page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(dev.page).toHaveURL(/\/home$/, { timeout: 30_000 })
  await dev.page.goto(projectUrl)
  await expect(dev.page.getByRole('heading', { name: 'Project not found' })).toBeVisible({ timeout: 15_000 })
})
