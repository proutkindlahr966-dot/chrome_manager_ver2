import { clampStepSpeed, paceDelay, STEP_SPEED_DEFAULT } from '../../shared/step-speed'
import { getDb } from '../db/database'

let cachedSpeed = STEP_SPEED_DEFAULT
let cachedAt = 0

function currentStepSpeed(): number {
  const now = Date.now()
  if (now - cachedAt < 1000) return cachedSpeed
  cachedAt = now
  try {
    cachedSpeed = clampStepSpeed(getDb().getSettings().stepSpeed)
  } catch {
    cachedSpeed = STEP_SPEED_DEFAULT
  }
  return cachedSpeed
}

/** Áp tốc độ trong Cài đặt lên khoảng chờ giữa các thao tác. */
export function pacedMs(ms: number): number {
  return paceDelay(ms, currentStepSpeed())
}
