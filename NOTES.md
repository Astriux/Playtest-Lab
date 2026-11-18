# Playtest Lab: build log

A running log of what was built, the decisions behind it, and what was tested.
Newest step at the bottom.

## Step 1: scaffold, sign-in, schemas, bare deploy (2026-11-18)

### What was built
- Scaffolded with `create-deepspace@0.44.2` (SDK pinned to exactly 0.44.2).
  The project lives in `playtest-lab/` because the scaffolder derives the app
  name from the folder, and "Playtest Lab" (space, capitals) isn't a legal name.
- Sign-in uses DeepSpace's built-in auth (GitHub / Google). `/home` sits under
  `src/pages/(app)/(protected)/`, so it requires sign-in.
- Six collections in `src/schemas/playtest-schemas.ts`: `projects`,
  `team_members`, `builds`, `sessions`, `feedback`, `themes`.
- Removed the scaffold's `settings` collection and example settings page.
- Own visual design ("lab" theme): warm paper background, ink text, one
  signal-orange accent, one color per feedback tag. Fonts: Bricolage
  Grotesque (headings), IBM Plex Sans (body), IBM Plex Mono (versions, counts).

### Access model (server-enforced)
- Every project-scoped row stores its `projectId`, declared as `teamField`.
- `read: 'team'` means you can read a row if you are its owner, or you have an
  active `team_members` row with `teamId = projectId`.
- `create: false` on every collection, for every role. All creates go through
  server actions that check team membership first. Otherwise any signed-in user
  could insert builds or sessions into someone else's project.
- `team_members` is read-only from the browser. If clients could write it,
  anyone could add themselves to any team and the whole model collapses.
- Where devs may edit from the browser, `writableFields` limits which fields
  (`projects.name`, `builds.changelog`), so nobody can move a row to another
  project by editing its `projectId`.
- `projects` has a `teamId` column equal to its own id, because the `team` rule
  needs a column to read the team id from.
- `feedback` uses `ownerField: 'testerId'`, so testers read their own notes and
  devs on the team read all of them.
- The app owner is `admin`, so every rule is given to both `member` and
  `admin`. No role gets a blanket `read: true`.

### Verified: (a) does the `team` owner check honor a custom ownerField?
Read the SDK source (`node_modules/deepspace/dist/worker.js`). Two code paths:

1. **Per-record checks** (single reads, live broadcasts, updates, deletes):
   `isOwner()` uses `record.data[ownerField]` when `ownerField` is set
   (worker.js ~617). The `team` level calls `isOwner` first. **Honors `testerId`.**
2. **List queries** (`useQuery`) with `read: 'team'`: built as SQL,
   `projectId IN (my teams) OR _created_by = me` (worker.js ~2245). **Ignores
   ownerField** and uses the row's creator instead.

So `ownerField: 'testerId'` alone is not enough for list views. It works here
because rows created in a server action are stamped with the *calling* user as
creator (worker.js ~1674, `X-User-Id` is the verified caller). The tester
calls `submitFeedback`, so creator = tester = `testerId`, and both paths agree.

Rule this creates: **feedback must always be created by the tester's own
action call**, never by a dev acting on their behalf. Otherwise the tester
couldn't see it in lists.

Side effect of the same query: anyone who *created* a row keeps seeing it in
lists even after being removed from the team. Acceptable for this app.

Also spotted: `notifyTeamMembershipChange` reads `record.data.UserId` (capital
U) while the column is `userId`. If so, a dev added to a team won't get a live
refresh and needs to reload once. To confirm in step 3.

### Verified: (b) how file permissions work for screenshots
From the file-uploads guide and `src/server/http-routes.ts`:

- Built-in storage (`useR2Files`) has two scopes:
  - `'self'`: only the uploader can read it.
  - `'app'`: **anyone with the URL** can read it, no sign-in.
- Neither fits "the tester and their project's devs". `'self'` hides it from
  devs; `'app'` makes playtest screenshots of unreleased games public.

Plan for step 3: a private R2 bucket declared in `wrangler.toml`
(`bucket_name = "auto"`) that only the worker can reach. Upload happens inside
`submitFeedback`. Viewing goes through a worker route that checks the caller is
the tester or an active team member, then streams the image. The route accepts
the same-origin session cookie (the SDK's `resolveSessionReadAuth`), so it
works as a plain `<img src>`.

### Tradeoffs
- No client-side creates means a little more server code, but the access rules
  can't be bypassed from the browser.
- Collections live in one file instead of one per file (scaffold convention),
  so the whole data model reads top to bottom.

### Tested
- `tsc --noEmit` and `eslint` pass; dev start prints no schema-lint warnings.
- `deepspace test run all`: 11/11 pass (smoke, API, and the two-user test
  where two `@deepspace.test` accounts each see their own signed-in session).
- Checked landing and signed-out `/home` at desktop and phone width in a
  browser; no console errors.
- Test accounts created for later steps: `dev-ava`, `tester-ben`,
  `outsider-cy` (all `@deepspace.test`; passwords saved locally by the CLI in
  `~/.deepspace/test-accounts.json`, never in the repo).

### Setup gotchas (Windows)
- PowerShell blocks `npx.ps1`; use `npx.cmd deepspace ...` instead (no need to
  change the execution policy).
- `deepspace auth login` needs an interactive terminal.

## Step 2: projects, builds, sessions, invite links, submitFeedback (2026-11-18)

### What was built
- **Server actions** in `src/actions/index.ts` (each is `POST /api/actions/<name>`):
  `createProject`, `addTeammate`, `addBuild`, `openSession`, `closeSession`,
  `joinSession`, `submitFeedback`. A small `callAction()` helper in
  `src/lib/actions.ts` calls them from the browser with the sign-in token.
- **Pages** (all require sign-in):
  - `/home`: your projects, plus a "new project" form.
  - `/projects/:id`: builds (newest first) with their sessions and note
    counts, "add a build" form, team list with "add teammate by email".
  - `/sessions/:id`: the dev's session view: invite link (copy), end
    session, every note with tag counts. Live: new notes appear without reload.
  - `/join/:inviteCode`: the tester's page: build version + changelog, four
    tag buttons, a text box, and "your notes".
- Signing in with Google/GitHub always returns to `/home`, which would lose an
  invite link. The sign-in gate now remembers the page you were on and sends
  you back (same-site paths only, so it can't be abused as a redirect).

### How each action protects itself
Action tools skip collection permissions entirely, so each action checks:
- **Who is calling** comes from the verified token, never from `params`.
- **Team membership** (`isTeamMember`: an active `team_members` row) before
  any project write: `addTeammate`, `addBuild`, `openSession`, `closeSession`.
  For build/session actions the project id is read from the stored record,
  not from the request.
- **submitFeedback** takes only `inviteCode`, `tag`, `text`. It looks up the
  session by code, refuses if it's closed, and copies `projectId`, `buildId`,
  `sessionId` from the session and `testerId` from the caller. A client that
  sends its own `projectId` or `testerId` is ignored.
- **Inputs** are trimmed and length-limited; tags must be one of the four.
- **addTeammate** returns only the teammate's name. Action tools see full
  user rows, emails included, so nothing else leaks back.

### Decisions and tradeoffs
- **The invite code is the key.** 10 random characters (~49 bits) from an
  alphabet without look-alikes. Anyone with the link who signs in can add notes
  until the dev ends the session. Simple to share; the dev's control is
  "end session".
- **Testers can't read sessions or projects.** `joinSession` returns just what
  the join page shows (project name, version, changelog, open/closed).
- **Teammates are added by email** and must have signed in once (their user
  row has to exist). Downside: it reveals whether an email has an account.
  Acceptable for a team tool; an invite-by-link flow would avoid it.
- **No toasts on the tester page.** On a phone the "note sent" toast covered
  the Send button and blocked the next note (found by the screenshot test).
  It's now an inline status line next to the button.
- Two writes in `createProject` (project, then membership) aren't atomic. If
  the second failed, the creator still owns the project row and could retry.

### Tested
- New spec `tests/playtest-flow.spec.ts`, with three real accounts:
  Ava creates a project, adds a build, opens a session; Ben joins via the
  invite link and sends a note; Ava sees it appear without reloading; Ben and
  Cy both get "not found" on the project and session pages; Ava ends the
  session and Ben's form disappears.
- All 12 tests pass (`deepspace test run all`), plus `tsc` and `eslint`.
- Screenshots of project, session, and join pages (desktop + phone) checked.
