import { describe, expect, it } from 'vitest'
import { runWithConcurrency } from './launch-queue'

describe('runWithConcurrency', () => {
  it('bỏ qua danh sách rỗng', async () => {
    let calls = 0
    await runWithConcurrency([], { concurrency: 2, gapMs: 0 }, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })

  it('giữ thứ tự bắt đầu và không vượt số luồng', async () => {
    const starts: number[] = []
    let inFlight = 0
    let maxInFlight = 0

    await runWithConcurrency([0, 1, 2, 3, 4], { concurrency: 2, gapMs: 15 }, async (item) => {
      starts.push(item)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 40))
      inFlight -= 1
    })

    expect(starts).toEqual([0, 1, 2, 3, 4])
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(maxInFlight).toBe(2)
  })
})
