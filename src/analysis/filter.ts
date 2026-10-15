import { trackingConfig } from './config.ts'
import type { PhaseSnapshot } from './types.ts'
import { notReady } from './types.ts'

export class SmoothedSignal {
  value: number | null = null
  velocity = 0
  private lastTime: number | null = null

  update(raw: number, timestampMs: number): number {
    if (this.value === null || this.lastTime === null) {
      this.value = raw
      this.lastTime = timestampMs
      this.velocity = 0
      return raw
    }
    const elapsedSeconds = Math.max(0.001, Math.min((timestampMs - this.lastTime) / 1000, 0.25))
    const alpha = 1 - Math.exp(-elapsedSeconds * 1000 / trackingConfig.smoothingTimeMs)
    const next = this.value + alpha * (raw - this.value)
    const instantaneous = (next - this.value) / elapsedSeconds
    this.velocity = this.velocity * 0.55 + instantaneous * 0.45
    this.value = next
    this.lastTime = timestampMs
    return next
  }

  reset(): void {
    this.value = null
    this.velocity = 0
    this.lastTime = null
  }
}

export class TrackingGate {
  private lastValidAt: number | null = null
  private everValid = false

  valid(timestampMs: number): void {
    this.lastValidAt = timestampMs
    this.everValid = true
  }

  missing(timestampMs: number, resetMeasurements: () => void): PhaseSnapshot {
    if (this.lastValidAt !== null && timestampMs - this.lastValidAt > trackingConfig.lostResetMs) {
      resetMeasurements()
      this.lastValidAt = null
    }
    if (!this.everValid) return notReady()
    return {
      phase: 'Tracking Lost',
      angles: [],
      side: null,
      detail: 'Required joints are not reliably visible. Reposition in the frame.',
    }
  }

  reset(): void {
    this.lastValidAt = null
    this.everValid = false
  }
}
