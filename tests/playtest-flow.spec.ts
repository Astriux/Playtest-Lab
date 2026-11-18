/**
 * The main flow with three real accounts:
 * a dev creates a project, adds a build, opens a session; a tester joins by
 * invite link and leaves a note; the dev sees it appear live; an outsider
 * can't open the project or session; ending the session stops new notes.
 *
 * Needs the test accounts "Ava (dev)", "Ben (tester)", "Cy (outsider)"
 * (see NOTES.md, step 1).
 */
import { test, expect } from 'deepspace/testing'

test('dev runs a session, tester leaves a note, outsider sees nothing', async ({ users }) => {
  test.setTimeout(90_000)
  const [dev, tester, outsider] = await users(['Ava (dev)', 'Ben (tester)', 'Cy (outsider)'])
  const projectName = `Flow test ${Date.now()}`

  // Dev: create project
  await dev.page.goto('/home')
  await dev.page.getByRole('button', { name: /New project|Create your first project/ }).click()
  // Submitting with no name explains what's missing instead of doing nothing
  await dev.page.getByRole('button', { name: 'Create project' }).click()
  await expect(dev.page.getByText('Enter a game name.')).toBeVisible()
  await dev.page.getByLabel('Game name').fill(projectName)
  await dev.page.getByRole('button', { name: 'Create project' }).click()
  await expect(dev.page).toHaveURL(/\/projects\/[\w-]+$/, { timeout: 15_000 })
  await expect(dev.page.getByRole('heading', { name: projectName })).toBeVisible()
  const projectUrl = new URL(dev.page.url()).pathname

  // Dev: add a build
  await dev.page.getByLabel('Version').fill('v0.4')
  await dev.page.getByLabel('What changed').fill('New wave system')
  await dev.page.getByRole('button', { name: 'Add build' }).click()
  await expect(dev.page.getByRole('button', { name: 'Open playtest session' })).toBeVisible({ timeout: 15_000 })

  // Dev: open a session and read the invite link
  await dev.page.getByRole('button', { name: 'Open playtest session' }).click()
  await expect(dev.page).toHaveURL(/\/sessions\/[\w-]+$/, { timeout: 15_000 })
  const sessionUrl = new URL(dev.page.url()).pathname
  const invite = await dev.page.getByLabel('Invite link').inputValue()
  const invitePath = new URL(invite).pathname
  expect(invitePath).toMatch(/^\/join\/[a-z2-9]{10}$/)

  // Tester: join and leave a note
  await tester.page.goto(invitePath)
  await expect(tester.page.getByText(`Playtesting ${projectName}`)).toBeVisible({ timeout: 15_000 })
  await tester.page.getByRole('button', { name: 'Send note' }).click()
  await expect(tester.page.getByText('Pick a tag first.')).toBeVisible()
  await tester.page.getByRole('button', { name: 'Balance' }).click()
  await tester.page.getByLabel('What happened?').fill('Wave 7 wiped me out three times')
  await tester.page.getByRole('button', { name: 'Send note' }).click()
  await expect(tester.page.getByRole('heading', { name: 'Your notes (1)' })).toBeVisible({ timeout: 15_000 })

  // Dev: the note shows up without a reload
  await expect(dev.page.getByText('Wave 7 wiped me out three times')).toBeVisible({ timeout: 15_000 })
  await expect(dev.page.getByRole('heading', { name: '1 note' })).toBeVisible()

  // Tester and outsider can't open the dev pages
  for (const other of [tester, outsider]) {
    await other.page.goto(projectUrl)
    await expect(other.page.getByRole('heading', { name: 'Project not found' })).toBeVisible({ timeout: 15_000 })
    await other.page.goto(sessionUrl)
    await expect(other.page.getByRole('heading', { name: 'Session not found' })).toBeVisible({ timeout: 15_000 })
  }

  // Dev ends the session; the tester's page no longer offers the form
  await dev.page.getByRole('button', { name: 'End session' }).click()
  await expect(dev.page.getByText('Ended', { exact: true })).toBeVisible({ timeout: 15_000 })
  await tester.page.goto(invitePath)
  await expect(tester.page.getByText('This session has ended')).toBeVisible({ timeout: 15_000 })
  await expect(tester.page.getByText('Wave 7 wiped me out three times')).toBeVisible()
})
