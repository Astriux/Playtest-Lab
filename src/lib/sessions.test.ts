import { describe, expect, it } from 'vitest'
import { hoursLeft, staleSessionIds } from './sessions'

const HOUR = 60 * 60 * 1000
const now = Date.parse('2026-11-18T12:00:00Z')
const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString()

describe('staleSessionIds', () => {
  it('returns only sessions open longer than 24 hours', () => {
    const sessions = [
      { recordId: 'fresh', createdAt: at(1) },
      { recordId: 'almost', createdAt: at(23.9) },
      { recordId: 'stale', createdAt: at(24.1) },
      { recordId: 'ancient', createdAt: at(200) },
    ]
    expect(staleSessionIds(sessions, now)).toEqual(['stale', 'ancient'])
  })
})

describe('hoursLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(hoursLeft(at(0), now)).toBe(24)
    expect(hoursLeft(at(22.5), now)).toBe(2)
    expect(hoursLeft(at(30), now)).toBe(0)
  })
})
