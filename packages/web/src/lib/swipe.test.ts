import { describe, expect, it } from 'vitest'
import { cardRelease, rowRelease, tracker } from './swipe.ts'

const W = 390

describe('rowRelease', () => {
  it('runs the right action past 35% or on a flick past 15%', () => {
    expect(rowRelease(140, 0, 0, W)).toBe('run')
    expect(rowRelease(60, 0, 0.6, W)).toBe('run')
    expect(rowRelease(40, 0, 0.6, W)).toBe('open')
  })
  it('opens on a slow short swipe (about a tenth of the row) and springs back below it', () => {
    expect(rowRelease(50, 0, 0, W)).toBe('open')
    expect(rowRelease(-50, 0, 0, W)).toBe('open')
    expect(rowRelease(-25, 0, 0, W)).toBe('close')
  })
  it('follows a flick: outward opens, back closes', () => {
    expect(rowRelease(-20, 0, -0.5, W)).toBe('open')
    expect(rowRelease(-150, 0, 0.5, W)).toBe('close')
  })
  it('an open row closes once swiped back 40px, else stays open', () => {
    expect(rowRelease(-190, -216, 0, W)).toBe('open')
    expect(rowRelease(-170, -216, 0, W)).toBe('close')
    expect(rowRelease(0, -216, 0, W)).toBe('close')
  })
})

describe('cardRelease', () => {
  it('goes past a quarter of the screen, or flicked past 40px', () => {
    expect(cardRelease(100, 0, W)).toBe(1)
    expect(cardRelease(-60, -0.5, W)).toBe(-1)
    expect(cardRelease(60, 0, W)).toBe(0)
    expect(cardRelease(60, -0.5, W)).toBe(0)
  })
})

describe('tracker', () => {
  it('measures the last moves, and nothing after a pause', () => {
    const speed = tracker()
    for (let t = 0; t <= 300; t += 16) speed.add(t * 0.5, t)
    expect(speed.velocity(300)).toBeCloseTo(0.5)
    expect(speed.velocity(500)).toBe(0)
  })
})
