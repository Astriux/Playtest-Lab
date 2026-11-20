import { describe, expect, it } from 'vitest'
import { cleanThemes, compareThemes, countChanges, LEFTOVER_THEME, mergeThemes, tallyThemes } from './themes'

describe('cleanThemes', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('drops ids the model made up', () => {
    const out = cleanThemes([{ name: 'Wave 7 too hard', summary: 's', noteIds: ['a', 'zzz'] }], ['a'])
    expect(out).toEqual([{ name: 'Wave 7 too hard', summary: 's', noteIds: ['a'] }])
  })

  it('puts each note in only one theme (first mention wins)', () => {
    const out = cleanThemes(
      [
        { name: 'One', summary: '', noteIds: ['a', 'b'] },
        { name: 'Two', summary: '', noteIds: ['b', 'c'] },
      ],
      ['a', 'b', 'c'],
    )
    expect(out.find((t) => t.name === 'One')!.noteIds).toEqual(['a', 'b'])
    expect(out.find((t) => t.name === 'Two')!.noteIds).toEqual(['c'])
  })

  it('merges themes whose names differ only in case or spacing', () => {
    const out = cleanThemes(
      [
        { name: 'Wave 7 too hard', summary: 'first', noteIds: ['a'] },
        { name: '  wave 7  TOO hard ', summary: 'second', noteIds: ['b'] },
      ],
      ['a', 'b'],
    )
    expect(out).toEqual([{ name: 'Wave 7 too hard', summary: 'first', noteIds: ['a', 'b'] }])
  })

  it('collects skipped notes into "Other notes" and removes empty themes', () => {
    const out = cleanThemes(
      [
        { name: 'Bugs', summary: '', noteIds: ['a'] },
        { name: 'Empty', summary: '', noteIds: [] },
      ],
      ids,
    )
    expect(out.map((t) => t.name)).toEqual([LEFTOVER_THEME, 'Bugs'])
    expect(out[0].noteIds).toEqual(['b', 'c', 'd'])
  })

  it('sorts biggest theme first and caps long names', () => {
    const long = 'x'.repeat(200)
    const out = cleanThemes(
      [
        { name: 'Small', summary: '', noteIds: ['a'] },
        { name: long, summary: '', noteIds: ['b', 'c', 'd'] },
      ],
      ids,
    )
    expect(out[0].name).toHaveLength(80)
    expect(out[1].name).toBe('Small')
  })
})

describe('compareThemes', () => {
  // [name, notes, distinct testers]
  const build = (testers: number, themes: [string, number, number][]) => ({
    testers,
    themes: themes.map(([name, notes, t]) => ({ name, notes, testers: t, theme: name })),
  })
  // 10 testers before, 5 after: raw note counts would halve by themselves.
  const v04 = build(10, [
    ['Wave 7 too hard', 9, 8],
    ['Crash when selling a tower', 3, 3],
    ['Tower placement unclear', 4, 4],
    ['Menus are slow', 6, 4],
  ])
  const v05 = build(5, [
    ['wave 7 too hard', 1, 1],
    ['Tower placement unclear', 3, 3],
    ['Boss music slaps', 3, 2],
    ['Menus are slow', 3, 2],
  ])
  const rows = compareThemes(v04, v05)
  const row = (name: string) => rows.find((r) => r.name.toLowerCase() === name.toLowerCase())!

  it('compares the share of testers, not raw note counts', () => {
    expect(row('Wave 7 too hard')).toMatchObject({ before: { rate: 0.8 }, after: { rate: 0.2 }, change: 'down' })
    // 4 notes → 3 notes looks better, but 40% of testers → 60% is worse.
    expect(row('Tower placement unclear')).toMatchObject({ before: { notes: 4 }, after: { notes: 3 }, change: 'up' })
  })

  it('treats a move under 10 points as the same', () => {
    // 6 notes → 3 notes, but 40% of testers both times: the playtest was just smaller.
    expect(row('Menus are slow')).toMatchObject({ before: { rate: 0.4 }, after: { rate: 0.4 }, change: 'same' })
  })

  it('labels new and gone', () => {
    expect(row('Boss music slaps')).toMatchObject({ before: { notes: 0 }, after: { testers: 2 }, change: 'new' })
    expect(row('Crash when selling a tower')).toMatchObject({ after: { notes: 0, rate: 0 }, change: 'gone' })
  })

  it('uses the newer build’s spelling of a name', () => {
    expect(row('Wave 7 too hard').name).toBe('wave 7 too hard')
  })

  it('puts the biggest movers first', () => {
    expect(rows[0].name).toBe('wave 7 too hard')
    expect(rows.at(-1)!.name).toBe('Menus are slow')
  })

  it('counts each kind of change', () => {
    expect(countChanges(rows)).toEqual({ down: 1, up: 1, same: 1, new: 1, gone: 1 })
  })
})

describe('tallyThemes', () => {
  it('counts one tester once, however many notes they wrote', () => {
    const testerOf = new Map([['a', 't1'], ['b', 't1'], ['c', 't2']])
    const [tally] = tallyThemes([{ name: 'X', feedbackIds: ['a', 'b', 'c', 'missing'] }], testerOf)
    expect(tally).toMatchObject({ notes: 4, testers: 2 })
  })
})

describe('mergeThemes', () => {
  it('joins notes without repeats and keeps both summaries', () => {
    const merged = mergeThemes([
      { summary: 'Grid is faint.', feedbackIds: ['a', 'b'] },
      { summary: 'Snow map is hard to read.', feedbackIds: ['b', 'c'] },
    ])
    expect(merged).toEqual({ summary: 'Grid is faint. Snow map is hard to read.', feedbackIds: ['a', 'b', 'c'] })
  })
})
