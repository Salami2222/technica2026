import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { golfConfig } from './config.ts'
import { addressLike, handLift, imageYToX, measureGolf, range, trailTravel } from './measure.ts'
import type { GolfSample } from './measure.ts'
import { scoreGolfSwing } from './score.ts'
import type { GolfPhase, GolfResult, GolfSnapshot, GolfStatus, Handedness } from './types.ts'

const recording = (phase: GolfPhase) =>
  phase === 'Backswing' || phase === 'Top' || phase === 'Downswing' || phase === 'Follow-through'

export class GolfSwingSession {
  readonly handedness: Handedness
  private status: GolfStatus = 'Idle'
  private phase: GolfPhase = 'Not Ready'
  private tracking: GolfSnapshot['tracking'] = 'not-ready'
  private detail = 'Select a hand and start a session.'
  private history: GolfResult[] = []
  private addressWindow: GolfSample[] = []
  private addressSamples: GolfSample[] = []
  private address: GolfSample | null = null
  private samples: GolfSample[] = []
  private finishWindow: GolfSample[] = []
  private lastSample: GolfSample | null = null
  private gapSince: number | null = null
  private missingMs = 0
  private startAt = 0
  private peakAt = 0
  private peak = -Infinity
  private topAt = 0
  private passAt = 0

  constructor(handedness: Handedness) { this.handedness = handedness }

  snapshot(): GolfSnapshot {
    return {
      status: this.status, phase: this.phase, tracking: this.tracking, handedness: this.handedness,
      swings: this.history.length, latest: this.history.at(-1) ?? null, history: [...this.history], detail: this.detail,
    }
  }

  start(): GolfSnapshot {
    if (this.active() || this.status === 'Paused') return this.snapshot()
    this.history = []
    this.resetMotion()
    this.status = 'Waiting for Address'
    this.phase = 'Not Ready'
    this.detail = 'Face the Kinect with your full body visible; settle into your address stance.'
    return this.snapshot()
  }

  pause(): GolfSnapshot {
    if (this.active()) {
      this.resetMotion()
      this.status = 'Paused'
      this.phase = 'Not Ready'
      this.detail = 'Session paused. The current swing was discarded.'
    }
    return this.snapshot()
  }

  resume(): GolfSnapshot {
    if (this.status === 'Paused') {
      this.resetMotion()
      this.status = 'Waiting for Address'
      this.detail = 'Hold the address stance to resume.'
    }
    return this.snapshot()
  }

  stop(): GolfSnapshot {
    if (this.active() || this.status === 'Paused') {
      this.resetMotion()
      this.status = 'Completed'
      this.phase = 'Not Ready'
      this.detail = `${this.history.length} recorded ${this.history.length === 1 ? 'swing' : 'swings'} in this session.`
    }
    return this.snapshot()
  }

  update(result: PoseLandmarkerResult, at: number): GolfSnapshot {
    if (!this.active()) return this.snapshot()
    const measured = measureGolf(result, at, this.handedness)
    if (!measured) return this.missing(at)
    const sample = this.smooth(measured)

    if (this.gapSince !== null) {
      const prior = this.lastSample
      const continuous = prior !== null && at - prior.at <= golfConfig.maxTrackingGapMs &&
        Math.abs(sample.handX - prior.handX) / prior.scale <= golfConfig.maxRecoveryHandJump &&
        Math.abs(sample.hipX - prior.hipX) / prior.scale <= golfConfig.maxRecoveryHandJump
      if (!continuous) {
        this.abortSwing()
        this.status = 'Tracking Lost'
        this.phase = 'Tracking Lost'
        this.detail = 'Tracking changed too much to continue that swing. Return to address.'
      } else {
        if (recording(this.phase)) this.missingMs += at - prior.at
        this.status = recording(this.phase) ? 'Recording' : this.phase === 'Address' ? 'Ready' : 'Waiting for Address'
        this.detail = 'Tracking recovered; resuming from the observed position.'
      }
      this.gapSince = null
      this.tracking = 'tracking'
      this.lastSample = sample
      if (recording(this.phase)) this.samples.push(sample)
      return this.snapshot() // A recovered frame never implies motion through the gap.
    }

    this.tracking = 'tracking'
    this.addressWindow.push(sample)
    this.addressWindow = this.addressWindow.filter((item) => at - item.at <= golfConfig.addressHoldMs)
    const settled = this.stableAddress(at)

    if (this.status === 'Waiting for Address' || this.status === 'Tracking Lost' || this.phase === 'Finish') {
      if (settled) {
        this.resetSwingOnly()
        this.address = sample
        this.addressSamples = [...this.addressWindow]
        this.phase = 'Address'
        this.status = 'Ready'
        this.detail = 'Address confirmed. Make a full practice swing.'
      } else if (this.phase === 'Finish') {
        this.status = 'Waiting for Address'
      } else {
        this.status = 'Waiting for Address'
        this.phase = 'Not Ready'
        this.detail = 'Hold a steady face-on address with hands below shoulders.'
      }
      this.lastSample = sample
      return this.snapshot()
    }

    const address = this.address
    if (!address) return this.snapshot()
    const trail = trailTravel(sample, address)
    const previousTrail = this.lastSample ? trailTravel(this.lastSample, address) : 0
    if (this.phase === 'Address') {
      if (trail >= golfConfig.backswingStart && trail - previousTrail >= golfConfig.movementStep) {
        this.phase = 'Backswing'
        this.status = 'Recording'
        this.startAt = at
        this.peak = trail
        this.peakAt = at
        this.samples = [sample]
        this.missingMs = 0
        this.detail = 'Backswing detected from hand travel toward the trail side.'
      }
    } else if (recording(this.phase)) {
      this.samples.push(sample)
      if (at - this.startAt > golfConfig.maxSwingMs) {
        this.abortSwing()
        this.status = 'Waiting for Address'
        this.detail = 'Swing timed out. Return to a steady address.'
      } else if (this.phase === 'Backswing') {
        if (trail > this.peak) { this.peak = trail; this.peakAt = at }
        if (this.peak >= golfConfig.backswingDepth &&
          trail <= this.peak - golfConfig.turnaroundDrop &&
          at - this.startAt >= golfConfig.minBackswingMs) {
          this.phase = 'Top'
          this.topAt = this.peakAt
          this.detail = 'Backswing turnaround detected.'
        }
      } else if (this.phase === 'Top') {
        if (previousTrail - trail >= golfConfig.movementStep) {
          this.phase = 'Downswing'
          this.detail = 'Hands are moving back through the approximate strike region.'
        }
      } else if (this.phase === 'Downswing') {
        if (trail <= golfConfig.strikeRegion) {
          this.phase = 'Follow-through'
          this.passAt = at
          this.detail = 'Hands passed the address region; continue into the finish.'
        }
      } else if (this.phase === 'Follow-through') {
        const candidate = -trail >= golfConfig.finishLeadTravel && handLift(sample, address) >= golfConfig.finishLift
        if (!candidate) this.finishWindow = []
        else {
          this.finishWindow.push(sample)
          if (this.finishWindow.length > 1 &&
            Math.max(range(this.finishWindow, 'handX'), range(this.finishWindow, 'handY') * imageYToX) / address.scale > golfConfig.finishStill) {
            this.finishWindow = [sample]
          }
          if (this.finishWindow.length >= 3 && at - this.finishWindow[0].at >= golfConfig.finishHoldMs) {
            this.phase = 'Finish'
            this.status = 'Waiting for Address'
            const scored = scoreGolfSwing({
              id: this.history.length + 1, handedness: this.handedness, address,
              addressSamples: this.addressSamples, samples: this.samples, finishSamples: this.finishWindow,
              startAt: this.startAt, topAt: this.topAt, passAt: this.passAt, finishAt: at,
              missingMs: this.missingMs,
            })
            this.history.push(scored)
            this.detail = scored.score === null ? scored.reason! : `Swing ${scored.id} scored ${scored.score.toFixed(1)} / 10. Return to address for another.`
            this.addressWindow = []
          }
        }
      }
    }
    this.lastSample = sample
    return this.snapshot()
  }

  missing(at: number): GolfSnapshot {
    if (!this.active()) return this.snapshot()
    if (!this.lastSample) {
      this.tracking = 'not-ready'
      this.status = 'Waiting for Address'
      return this.snapshot()
    }
    this.gapSince ??= at
    this.addressWindow = []
    if (this.lastSample && at - this.lastSample.at <= golfConfig.maxTrackingGapMs) {
      this.tracking = 'partial'
      this.status = recording(this.phase) ? 'Tracking Lost' : this.status
      this.detail = 'Partial tracking: swing position is held briefly; no motion is inferred.'
    } else {
      this.tracking = 'lost'
      this.abortSwing()
      this.status = 'Tracking Lost'
      this.phase = 'Tracking Lost'
      this.detail = 'Tracking lost. Return to address when the required joints are visible.'
    }
    return this.snapshot()
  }

  private stableAddress(at: number): boolean {
    const window = this.addressWindow
    if (window.length < 3 || at - window[0].at < golfConfig.addressHoldMs) return false
    if (!window.every(addressLike)) return false
    const scale = window[0].scale
    return Math.max(range(window, 'handX'), range(window, 'handY') * imageYToX) / scale <= golfConfig.addressHandStill &&
      Math.max(range(window, 'shoulderX'), range(window, 'hipX')) / scale <= golfConfig.addressTorsoStill
  }

  private smooth(measured: GolfSample): GolfSample {
    const previous = this.lastSample
    if (!previous || this.gapSince !== null) return measured
    const elapsed = Math.max(1, measured.at - previous.at)
    const alpha = 1 - Math.exp(-elapsed / golfConfig.positionSmoothingMs)
    const blend = (current: number, prior: number) => prior + alpha * (current - prior)
    return {
      ...measured,
      handX: blend(measured.handX, previous.handX),
      handY: blend(measured.handY, previous.handY),
      shoulderX: blend(measured.shoulderX, previous.shoulderX),
      hipX: blend(measured.hipX, previous.hipX),
      ankleX: blend(measured.ankleX, previous.ankleX),
      headX: measured.headX === null || previous.headX === null ? measured.headX : blend(measured.headX, previous.headX),
    }
  }

  private resetSwingOnly(): void {
    this.samples = []
    this.finishWindow = []
    this.peak = -Infinity
    this.peakAt = 0
    this.startAt = 0
    this.topAt = 0
    this.passAt = 0
    this.missingMs = 0
  }

  private abortSwing(): void {
    this.resetSwingOnly()
    this.address = null
    this.addressSamples = []
    this.addressWindow = []
  }

  private resetMotion(): void {
    this.abortSwing()
    this.lastSample = null
    this.gapSince = null
    this.tracking = 'not-ready'
  }

  private active(): boolean {
    return this.status === 'Waiting for Address' || this.status === 'Ready' ||
      this.status === 'Recording' || this.status === 'Tracking Lost'
  }
}
