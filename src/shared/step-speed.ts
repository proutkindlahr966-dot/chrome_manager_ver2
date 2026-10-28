/** 1 = tốc độ hiện tại. Lớn hơn thì các bước nhanh hơn, nhỏ hơn thì chậm hơn. */
export const STEP_SPEED_MIN = 0.4
export const STEP_SPEED_MAX = 3
export const STEP_SPEED_DEFAULT = 1

export function clampStepSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return STEP_SPEED_DEFAULT
  const clamped = Math.min(STEP_SPEED_MAX, Math.max(STEP_SPEED_MIN, n))
  return Math.round(clamped * 10) / 10
}

export function stepSpeedLabel(speed: number): string {
  const value = clampStepSpeed(speed)
  if (value >= 2.4) return 'Rất nhanh'
  if (value >= 1.4) return 'Nhanh'
  if (value <= 0.55) return 'Rất chậm'
  if (value <= 0.85) return 'Chậm'
  return 'Bình thường'
}

/** Thời gian chờ sau khi nhân theo tốc độ. Không xuống dưới 20ms. */
export function paceDelay(ms: number, speed: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const scaled = ms / clampStepSpeed(speed)
  return Math.max(20, Math.round(scaled))
}

/** 0 = chậm nhất, 50 = bình thường, 100 = nhanh nhất. */
export function stepSpeedToSlider(speed: number): number {
  const value = clampStepSpeed(speed)
  if (value <= 1) return ((value - STEP_SPEED_MIN) / (1 - STEP_SPEED_MIN)) * 50
  return 50 + ((value - 1) / (STEP_SPEED_MAX - 1)) * 50
}

export function sliderToStepSpeed(position: number): number {
  const t = Number.isFinite(position) ? Math.min(100, Math.max(0, position)) : 50
  if (t <= 50) return clampStepSpeed(STEP_SPEED_MIN + (1 - STEP_SPEED_MIN) * (t / 50))
  return clampStepSpeed(1 + (STEP_SPEED_MAX - 1) * ((t - 50) / 50))
}
