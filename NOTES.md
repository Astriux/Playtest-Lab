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

### User testing: "I can't create a project" (2026-11-18)
- **What happened:** testing the live app, I couldn't create a project. The
  "New project" button was greyed out until a name was typed, and nothing
  said so. The logs confirmed no request ever reached the server.
- **Change:** "New project" (and "Create your first project" in the empty
  state) now opens a dialog that asks for the game name. Buttons are no
  longer disabled just because a field is empty. Pressing them explains
  what's missing ("Enter a game name.", "Pick a tag first.").
- **Applied the same rule** to Add build, Add teammate, and the tester's
  Send note, which had the same silent greyed-out button.
- **Rule going forward:** only disable a button while it's busy. Otherwise
  let people press it and tell them what's missing.
- Flow test now also checks both "what's missing" messages; all 12 tests pass.

## Reference: how the example apps set the bar (read 2026-11-18)

Skimmed the source of three examples named in the brief (github.com/deepdotspace):

| | StoryNest | ThreadHunt | RunningMap |
|---|---|---|---|
| Size | ~14k lines | ~12k lines | ~14k lines |
| Who sees what | owner + public "published" books | single user (`read: 'own'`) | single user (`read: 'own'`) |
| Server actions | 17 (credits, generation, sharing) | 8 (topics, scans, drafts) | none |
| Integrations | Claude, Gemini images, ElevenLabs audio | Firecrawl search, Claude | none (free public APIs from the browser) |
| Background work | JobRoom pipeline with retries | JobRoom scans + cron rescans | none |
| Files | public (`'app'` scope) book art | none | none |
| Other | credits + subscriptions | keyboard triage, CSV export | 18 unit-test files of map/geo logic |

What this means for Playtest Lab:
- **Where we go further:** none of the three has more than one kind of user
  sharing data. Playtest Lab's dev team / tester / outsider model with the
  `team` rule, `team_members`, and server actions that check membership is
  a DeepSpace capability none of them exercise.
- **Where they go further:** integration and pipeline depth. StoryNest chains
  three AI services as a background job; ThreadHunt runs scheduled scans.
  Our AI step is one well-designed call, so it has to be good.
- **Contrast worth explaining:** StoryNest stores images with public `'app'`
  scope because shared books are meant to be public. Our screenshots are
  unreleased-game captures that must stay private to one team, which is why
  we need our own bucket and a server-side check.
- **AI calls:** ThreadHunt and StoryNest call Claude through
  `createDeepSpaceAI(env, 'anthropic')` + the `ai` package, billed to the app
  owner's DeepSpace credits, with no API key to manage. Step 4 will do the same.
- **Tests:** RunningMap unit-tests its pure logic. The build-comparison math
  (up / down / new / gone) is a pure function and gets unit tests in step 4.

## Step 3: screenshots, live feed, permission proof (2026-11-18)

### What was built
- **Private screenshot storage.** A dedicated R2 bucket (`SCREENSHOTS` in
  `wrangler.toml`, `bucket_name = "auto"` so DeepSpace creates it on deploy).
  Only the worker can reach it; there is no public URL.
  - Upload rides along with `submitFeedback`. The server decodes the image,
    checks its first bytes to confirm it really is JPEG / PNG / WebP (not
    what the browser claims), caps it at 2 MB, and stores it under
    `screenshots/<projectId>/<feedbackId>`. If saving the note fails, the
    image is deleted again.
  - Viewing goes through `GET /api/screenshots/:feedbackId`
    (`src/server/screenshot-routes.ts`). It allows the tester who wrote the
    note or an active team member, and answers 404 to everyone else, so an
    outsider can't even tell whether a screenshot exists.
  - The browser shrinks images to 1600px and re-encodes them as JPEG before
    upload. A 4K screenshot drops to a few hundred KB, and hidden metadata
    (like GPS location from a phone photo) is stripped.
  - Testers can click **Add screenshot** or just **paste** (Win+Shift+S, then
    Ctrl+V), which is the natural flow when playing on PC.
- **Live feed for devs** on the session page: notes still arrive live via
  `useQuery`; new arrivals glow for 3 seconds; filter buttons per tag with
  counts; "N notes from M testers"; screenshot thumbnails that open full size.
- **Shared access helpers** in `src/server/access.ts` (`isTeamMember`,
  `canReadFeedback`), used by both the actions and the screenshot route, so
  there is one definition of "who may see this".

### Why a custom bucket instead of the built-in file storage
`useR2Files` offers `'self'` (only the uploader) or `'app'` (anyone with the
URL). Devs couldn't see `'self'` screenshots, and `'app'` would make
screenshots of unreleased games public. StoryNest uses `'app'` on purpose
because its books are meant to be shared; our case is the opposite. The cost
is ~40 lines of our own route plus an access check we have to get right, which
the permission test covers.

### Permission proof: `tests/permissions.spec.ts`
Three real accounts: **Ava** (dev on the team), **Ben** (tester via invite
link), **Cy** (outsider). Checked at the server, not the UI:

1. **What the server actually sends.** The test records every WebSocket
   message each user receives while opening the project, session and invite
   pages. That's the raw data their browser got, whatever the UI showed.
   - Ava receives the project, Ben's note and her own note (proves the
     recording works).
   - Ben receives his own note, but **not** Ava's note, the project name, or
     the build version.
   - Cy receives **none** of them.
2. **Direct action calls** as Ben and as Cy: `addBuild`, `openSession`,
   `closeSession`, and adding themselves with `addTeammate` all fail with
   "You are not on this project."
3. **Spoofing:** Ben submits a note claiming `testerId = Ava` and a different
   `projectId`. The server ignores both. Proof: Ben can still fetch that
   note's screenshot, which he couldn't if it had been saved as Ava's.
4. **Bad files:** an SVG with a `<script>` sent as a "screenshot" is refused.
5. **Screenshot route:** Ava 200 `image/png`, Ben 200, Cy 404, signed-out 401.
6. **Granting access works:** after Ava adds Cy to the team, Cy can open the
   project and fetch the screenshot.

### Confirmed SDK issue: new teammates need one reload
Step 1 spotted `notifyTeamMembershipChange` reading `record.data.UserId`
(capital U) while the column is `userId`. The permission test now measures
it: when Ava adds Cy, Cy's already-open page does **not** update by itself
(`membership-live-update: false`); after a reload he sees everything. Access
is correct, only the live refresh is missing. Impact is small (a new teammate
usually opens the app fresh), so no workaround in the app. Worth reporting
to DeepSpace (`npx deepspace feedback`).

### Bugs found while testing
- The notes heading read as "1 note**from** 1 tester" to screen readers (the gap
  was CSS margin, not a space). Fixed in the markup.

### Tradeoffs and limits
- Screenshots travel inside the action's JSON as base64 (~33% bigger than
  raw). Fine at under 2 MB after shrinking; a direct upload route would scale
  better for video or huge files, which this app doesn't need.
- No per-tester upload limit. A tester with the link could fill storage with
  many 2 MB images until the session is ended. Acceptable for invited
  playtests; a per-session cap would be the next step.
- Images are fetched with the sign-in token and shown via a local blob URL,
  because a plain `<img src>` can't send the token.

### Tested
- All 13 tests pass (`deepspace test run all`), including the new permission
  spec and the flow spec, which now uploads a screenshot through the real form
  and checks the dev sees the thumbnail.
- Screenshots of the live feed (filters, thumbnails, glow) and the tester
  form with an attached image checked at desktop and phone width.
