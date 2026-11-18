/**
 * Demo data: three builds of a tower defense game.
 *
 * The story it tells on the compare page (v0.4 → v0.5):
 * - "Wave 7 too hard" drops 6 → 1   (the balance fix worked)
 * - "Crash when selling towers" gone (the bug fix worked)
 * - "Can't tell where towers go" rises 3 → 4, even though the changelog
 *   says "brighter placement grid" (the fix did NOT work; this is the
 *   case Playtest Lab exists to catch)
 * v0.6 has an open session and no notes, so the tester flow can be tried.
 *
 * Themes are written here by hand in the same shape the AI produces, so the
 * demo is instant and costs no credits. "Re-summarize" runs the real AI.
 */

import type { Tag } from '../schemas/playtest-schemas'

type DemoNote = { tag: Tag; text: string; tester: number }
type DemoTheme = { name: string; summary: string; notes: number[] }
export type DemoBuild = {
  version: string
  changelog: string
  sessionOpen: boolean
  notes: DemoNote[]
  themes: DemoTheme[]
}

export const DEMO_PROJECT_NAME = 'Tower Defense (demo)'

/** Fake tester ids. The UI shows them as "Demo tester N". */
export const demoTesterId = (n: number) => `demo-tester-${n}`

export const DEMO_BUILDS: DemoBuild[] = [
  {
    version: 'v0.4',
    changelog: 'New wave system and the chain-lightning tower',
    sessionOpen: false,
    notes: [
      { tag: 'balance', text: 'Wave 7 wiped me out three times in a row', tester: 1 },
      { tag: 'balance', text: 'Wave 7 is way harder than wave 8, weird spike', tester: 2 },
      { tag: 'balance', text: 'Gave up on wave 7, too many fast enemies at once', tester: 3 },
      { tag: 'balance', text: 'The flyers in wave 7 shred everything', tester: 4 },
      { tag: 'balance', text: "Couldn't get past wave 7 even with full upgrades", tester: 1 },
      { tag: 'balance', text: 'wave 7 difficulty spike is brutal', tester: 3 },
      { tag: 'bug', text: 'Game froze when I sold a tower mid-wave', tester: 2 },
      { tag: 'bug', text: 'Selling a tower during a wave crashed the game', tester: 4 },
      { tag: 'bug', text: 'Crash right after selling the cannon tower', tester: 1 },
      { tag: 'confusing', text: "Not sure where I'm allowed to place towers", tester: 2 },
      { tag: 'confusing', text: 'The placement grid is really hard to see', tester: 3 },
      { tag: 'confusing', text: "Didn't realise path tiles can't hold towers", tester: 4 },
      { tag: 'confusing', text: 'What does the blue upgrade icon do?', tester: 1 },
      { tag: 'fun', text: 'Boss music goes hard', tester: 2 },
      { tag: 'fun', text: 'Love the chain-lightning tower', tester: 3 },
    ],
    themes: [
      {
        name: 'Wave 7 too hard',
        summary: 'Players hit a sharp difficulty spike at wave 7, mostly from fast enemies and flyers.',
        notes: [0, 1, 2, 3, 4, 5],
      },
      { name: 'Crash when selling towers', summary: 'Selling a tower during a wave freezes or crashes the game.', notes: [6, 7, 8] },
      {
        name: "Can't tell where towers go",
        summary: "Players can't see which tiles accept towers; the placement grid is hard to read.",
        notes: [9, 10, 11],
      },
      { name: 'Upgrade icon unclear', summary: "A player didn't know what the blue upgrade icon does.", notes: [12] },
      { name: 'Boss music is great', summary: 'Players love the boss music.', notes: [13] },
      { name: 'Love the chain-lightning tower', summary: 'The chain-lightning tower is a favorite.', notes: [14] },
    ],
  },
  {
    version: 'v0.5',
    changelog: 'Wave 7 easier, fixed the sell-tower crash, brighter placement grid, new ice tower',
    sessionOpen: false,
    notes: [
      { tag: 'balance', text: 'Wave 7 still a bit tough with only 2 towers', tester: 2 },
      { tag: 'balance', text: 'Wave 12 boss is way too tanky', tester: 1 },
      { tag: 'balance', text: 'Wave 12 boss took forever to kill', tester: 3 },
      { tag: 'bug', text: "Pause menu doesn't open with a controller", tester: 4 },
      { tag: 'confusing', text: "Still can't tell where towers can go", tester: 1 },
      { tag: 'confusing', text: 'Placement highlights are too faint on grass', tester: 2 },
      { tag: 'confusing', text: 'Which tiles are buildable??', tester: 3 },
      { tag: 'confusing', text: 'Hard to see where I can build on the snow map', tester: 4 },
      { tag: 'fun', text: 'Boss music still slaps', tester: 1 },
      { tag: 'fun', text: 'The new ice tower is so satisfying', tester: 2 },
      { tag: 'fun', text: 'Chain-lightning plus ice combo is great', tester: 3 },
    ],
    themes: [
      {
        name: 'Wave 7 too hard',
        summary: 'One player still found wave 7 tough with few towers; nobody else mentioned it.',
        notes: [0],
      },
      { name: 'Wave 12 boss too tanky', summary: 'The wave 12 boss takes far too long to kill.', notes: [1, 2] },
      { name: 'Pause menu fails with controller', summary: 'The pause menu does not open with a controller.', notes: [3] },
      {
        name: "Can't tell where towers go",
        summary: 'Placement is still hard to read, especially on the grass and snow maps.',
        notes: [4, 5, 6, 7],
      },
      { name: 'Boss music is great', summary: 'Players still love the boss music.', notes: [8] },
      { name: 'New ice tower is satisfying', summary: 'The new ice tower feels great to use.', notes: [9] },
      { name: 'Love the chain-lightning tower', summary: 'Chain-lightning is still a favorite, especially with ice.', notes: [10] },
    ],
  },
  {
    version: 'v0.6',
    changelog: 'Wave 12 boss rework, placement outlines on every map',
    sessionOpen: true,
    notes: [],
    themes: [],
  },
]
