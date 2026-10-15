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
  private interrupted = false

  expired(timestampMs: number): boolean {
    return this.lastValidAt !== null && timestampMs - this.lastValidAt > trackingConfig.lostResetMs
  }

  valid(timestampMs: number): boolean {
    const resumed = this.interrupted
    this.lastValidAt = timestampMs
    this.everValid = true
    this.interrupted = false
    return resumed
  }

  missing(timestampMs: number, phase: PhaseSnapshot['phase'], side: PhaseSnapshot['side'], resetMeasurements: () => void): PhaseSnapshot {
    if (!this.everValid) return notReady()
    this.interrupted = true
    if (this.lastValidAt !== null && timestampMs - this.lastValidAt <= trackingConfig.lostResetMs) {
      return {
        phase,
        tracking: 'partial',
        angles: [],
        side,
        detail: 'Partial Tracking: holding the last phase while required joints are briefly obscured.',
      }
    }
    if (this.lastValidAt !== null) {
      resetMeasurements()
      this.lastValidAt = null
    }
    return {
      phase: 'Tracking Lost',
      tracking: 'lost',
      angles: [],
      side: null,
      detail: 'Required joints are not reliably visible. Reposition in the frame.',
    }
  }

  reset(): void {
    this.lastValidAt = null
    this.everValid = false
    this.interrupted = false
  }
}
