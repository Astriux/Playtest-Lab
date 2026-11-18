# Playtest Lab

**Did your fix actually work?** Playtest feedback for game developers, compared
build over build. Built on [DeepSpace](https://docs.deep.space).

**Live:** https://playtest-lab.app.space

Devs run a playtest session on a specific build and share an invite link.
Testers leave quick tagged notes (bug / balance / confusing / fun) with an
optional screenshot while they play, and the dev sees them arrive live. After
the session, AI groups the notes into named themes. Run the next build's
session and the compare page shows which themes went down, went up, appeared,
or disappeared ("Wave 7 too hard: 6 → 1").

## Try it in a minute
1. Sign in, then press **Try the demo** (or **Explore a demo project**).
2. Press **Compare builds**: a balance fix that worked, a crash that's gone,
   and a "brighter placement grid" that *didn't* fix placement complaints.
3. Open the v0.6 live session, copy the invite link into a private window
   with a second account, and send a note with a pasted screenshot.

## How it's built

| Piece | DeepSpace feature | Why |
|---|---|---|
| Who sees what | Collection permissions with the `team` level, `teamField`, a `team_members` collection, `ownerField: 'testerId'`, `writableFields` | Checked on the server for every read and live update. Devs see the project; testers see only their own notes; outsiders get nothing. |
| Every create | Server actions (`src/actions/index.ts`) | No collection allows creates from the browser. Each action checks team membership, and `submitFeedback` takes project, build and tester ids from the server, never the client. |
| Live feed | `useQuery` real-time sync | Notes appear on the dev's screen as testers send them. |
| Screenshots | Built-in file storage, tester's private (`'self'`) folder via `appFiles`, behind our own checked route | Built-in scopes are "uploader only" or "public"; we needed "tester + their project's team". |
| Themes | `createDeepSpaceAI` + structured output (Claude Sonnet 5.5) | No API key; billed to the owner's DeepSpace credits. The previous build's theme names go in the prompt so the same issue keeps the same name. |
| Auto-end sessions | Cron task (`src/cron.ts`) | Sessions left open end on their own after 24 hours. |

## Left out on purpose
Payments, chat, collaborative text editing, and video uploads: none of them
help answer "did my fix work?". For motion, testers paste a clip link
(Medal, YouTube, Streamable) instead. A few uploaded clips would fill the free
plan's 128 MiB file allowance, and links cost nothing to store. Also no project/build deletion, per-tester
upload caps, or per-tester rates on the compare page (see "What's next").

## What's next
- Normalize counts by number of testers, so a smaller playtest isn't
  mistaken for a fix.
- Remove teammates and delete builds/projects.
- A per-session upload cap, and a lock so two devs can't summarize at once.
- Let the dev rename or merge themes by hand when the AI groups imperfectly.

## Run it locally
```sh
npm install
npx deepspace auth login      # Windows PowerShell: use npx.cmd
npx deepspace dev start
npx deepspace test run all    # needs test accounts, see NOTES.md
RUN_AI_TESTS=1 npx deepspace test run tests/summarize.spec.ts   # calls Claude
```

The full build log, decisions, findings from the SDK source, and test
results are in [NOTES.md](NOTES.md).
