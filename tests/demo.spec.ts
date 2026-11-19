/**
 * The demo project: one click gives a project whose compare page tells the
 * intended story (a fix that worked, a bug that's gone, a fix that didn't).
 */
import { test, expect } from 'deepspace/testing'

test('demo project shows a full build comparison', async ({ users }) => {
  test.setTimeout(90_000)
  const [dev] = await users(['Ava (dev)'])
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
  await expect(row('Wave 7 too hard')).toContainText('▼ 5')
  await expect(row('Crash when selling towers')).toContainText('Gone')
  await expect(row("Can't tell where towers go")).toContainText('▲ 1')
  await expect(row('Wave 12 boss too tanky')).toContainText('New')

  // Opening a theme shows its notes and who wrote them.
  await row('Wave 7 too hard').locator('summary').click()
  await expect(row('Wave 7 too hard')).toContainText('The flyers in wave 7 shred everything')
  await expect(row('Wave 7 too hard')).toContainText('Demo tester 4')

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
