/**
 * Chạy danh sách theo thứ tự, giới hạn số việc đang chạy
 * và khoảng cách tối thiểu giữa hai lần bắt đầu.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  options: { concurrency: number; gapMs: number },
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const concurrency = Math.min(items.length, Math.max(1, Math.floor(options.concurrency) || 1))
  const gapMs = Math.max(0, options.gapMs)
  let cursor = 0
  let lastStartAt = 0
  let startChain: Promise<void> = Promise.resolve()

  async function reserveStart(index: number): Promise<void> {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const prev = startChain
    startChain = gate
    await prev
    try {
      if (index > 0 && gapMs > 0) {
        const wait = gapMs - (Date.now() - lastStartAt)
        if (wait > 0) await delay(wait)
      }
      lastStartAt = Date.now()
    } finally {
      release()
    }
  }

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await reserveStart(index)
      await task(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
