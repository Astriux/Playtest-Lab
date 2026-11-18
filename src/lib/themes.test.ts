import { describe, expect, it } from 'vitest'
import { cleanThemes, compareThemes, countChanges, LEFTOVER_THEME } from './themes'

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
  const v04 = [
    { name: 'Wave 7 too hard', count: 7 },
    { name: 'Crash when selling a tower', count: 3 },
    { name: 'Tower placement unclear', count: 4 },
    { name: 'Menus are slow', count: 2 },
  ]
  const v05 = [
    { name: 'wave 7 too hard', count: 1 },
    { name: 'Tower placement unclear', count: 5 },
    { name: 'Boss music slaps', count: 3 },
    { name: 'Menus are slow', count: 2 },
  ]
  const rows = compareThemes(v04, v05)
  const row = (name: string) => rows.find((r) => r.name.toLowerCase() === name.toLowerCase())!

  it('matches themes by name, ignoring case', () => {
    expect(row('Wave 7 too hard')).toMatchObject({ before: 7, after: 1, change: 'down' })
  })

  it('labels up, same, new and gone', () => {
    expect(row('Tower placement unclear').change).toBe('up')
    expect(row('Menus are slow').change).toBe('same')
    expect(row('Boss music slaps')).toMatchObject({ before: 0, after: 3, change: 'new' })
    expect(row('Crash when selling a tower')).toMatchObject({ before: 3, after: 0, change: 'gone' })
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
