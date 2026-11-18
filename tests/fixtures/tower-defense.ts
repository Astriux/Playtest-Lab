/** Realistic playtest notes for two builds of a tower defense game. */
export type FixtureNote = { tag: 'bug' | 'balance' | 'confusing' | 'fun'; text: string }

export const V04_NOTES: FixtureNote[] = [
  { tag: 'balance', text: 'Wave 7 wiped me out three times in a row' },
  { tag: 'balance', text: 'Wave 7 is way harder than wave 8, weird spike' },
  { tag: 'balance', text: 'Gave up on wave 7, too many fast enemies at once' },
  { tag: 'balance', text: 'The flyers in wave 7 shred everything' },
  { tag: 'balance', text: "Couldn't get past wave 7 even with full upgrades" },
  { tag: 'balance', text: 'wave 7 difficulty spike is brutal' },
  { tag: 'bug', text: 'Game froze when I sold a tower mid-wave' },
  { tag: 'bug', text: 'Selling a tower during a wave crashed the game' },
  { tag: 'bug', text: 'Crash right after selling the cannon tower' },
  { tag: 'confusing', text: "Not sure where I'm allowed to place towers" },
  { tag: 'confusing', text: 'The placement grid is really hard to see' },
  { tag: 'confusing', text: "Didn't realise path tiles can't hold towers" },
  { tag: 'confusing', text: 'What does the blue upgrade icon do?' },
  { tag: 'fun', text: 'Boss music goes hard' },
  { tag: 'fun', text: 'Love the chain-lightning tower' },
]

export const V05_NOTES: FixtureNote[] = [
  { tag: 'balance', text: 'Wave 7 still a bit tough with only 2 towers' },
  { tag: 'balance', text: 'Wave 12 boss is way too tanky' },
  { tag: 'balance', text: 'Wave 12 boss took forever to kill' },
  { tag: 'bug', text: "Pause menu doesn't open with a controller" },
  { tag: 'confusing', text: "Still can't tell where towers can go" },
  { tag: 'confusing', text: 'Placement highlights are too faint on grass' },
  { tag: 'confusing', text: 'Which tiles are buildable??' },
  { tag: 'confusing', text: 'Hard to see where I can build on the snow map' },
  { tag: 'fun', text: 'Boss music still slaps' },
  { tag: 'fun', text: 'The new ice tower is so satisfying' },
  { tag: 'fun', text: 'Chain-lightning plus ice combo is great' },
]
