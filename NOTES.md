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
- `tsc --noEmit` and `eslint` pass.
