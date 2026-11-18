/** The demo's playtest notes, reused as realistic test input. */
import { DEMO_BUILDS } from '../../src/demo/tower-defense'

export type FixtureNote = { tag: 'bug' | 'balance' | 'confusing' | 'fun'; text: string }

const notesOf = (version: string): FixtureNote[] =>
  DEMO_BUILDS.find((b) => b.version === version)!.notes.map(({ tag, text }) => ({ tag, text }))

export const V04_NOTES = notesOf('v0.4')
export const V05_NOTES = notesOf('v0.5')
