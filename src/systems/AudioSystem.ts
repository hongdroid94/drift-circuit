/**
 * Procedural audio.
 *
 * Every sound is synthesised at runtime with Web Audio — no audio files ship at
 * all. That keeps the download inside the portal size budget and, more usefully
 * for a driving game, lets the engine note track speed continuously instead of
 * cross-fading between a handful of recorded loops.
 *
 * Browsers block audio until a user gesture, so the context starts suspended
 * and `unlock()` is wired to the first real interaction.
 */

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // Engine voices: two detuned saws through a lowpass give a passable
  // combustion tone without sample data.
  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private skidSource: AudioBufferSourceNode | null = null;
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;

  private started = false;
  private muted = false;
  private running = false;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture handler. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      this.ctx = null;
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);

    this.buildEngine();
    this.buildSkid();
    this.started = true;
  }

  private buildEngine(): void {
    const ctx = this.ctx!;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 6;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineA = ctx.createOscillator();
    this.engineA.type = 'sawtooth';
    this.engineA.frequency.value = 60;

    this.engineB = ctx.createOscillator();
    this.engineB.type = 'square';
    this.engineB.frequency.value = 60;
    // Slight detune is what stops it sounding like a test tone.
    this.engineB.detune.value = -14;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    this.engineB.connect(subGain);

    this.engineA.connect(this.engineFilter);
    subGain.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master!);

    this.engineA.start();
    this.engineB.start();
  }

  private buildSkid(): void {
    const ctx = this.ctx!;
    // One second of white noise, looped. Cheaper and more controllable than a
    // per-frame noise generator.
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      channel[i] = (seed / 0x3fffffff) - 1;
    }

    this.skidSource = ctx.createBufferSource();
    this.skidSource.buffer = buffer;
    this.skidSource.loop = true;

    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1600;
    this.skidFilter.Q.value = 1.4;

    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;

    this.skidSource.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.master!);
    this.skidSource.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }

  /** Engine idles but does not rev outside a race. */
  setRunning(running: boolean): void {
    this.running = running;
    if (!running) this.setSkid(0);
  }

  /**
   * @param speedRatio 0..1 of top speed
   * @param throttle -1..1
   * @param boosting whether boost thrust is active
   */
  updateEngine(speedRatio: number, throttle: number, boosting: boolean): void {
    if (!this.ctx || !this.engineA || !this.engineB || !this.engineGain || !this.engineFilter) return;
    const now = this.ctx.currentTime;

    // Fake a gearbox: RPM ramps within a gear then drops on the shift, which
    // reads as acceleration far better than one continuous sweep.
    const gearCount = 5;
    const gear = Math.min(gearCount - 1, Math.floor(speedRatio * gearCount));
    const withinGear = speedRatio * gearCount - gear;
    const rpm = 0.28 + withinGear * 0.72;

    const base = 52 + rpm * 145 + (boosting ? 26 : 0);
    this.engineA.frequency.setTargetAtTime(base, now, 0.045);
    this.engineB.frequency.setTargetAtTime(base * 0.5, now, 0.045);
    this.engineFilter.frequency.setTargetAtTime(600 + rpm * 2100 + speedRatio * 900, now, 0.06);

    const load = Math.max(0, throttle);
    const target = this.running ? 0.055 + load * 0.1 + speedRatio * 0.075 : 0.03;
    this.engineGain.gain.setTargetAtTime(target, now, 0.08);
  }

  /** @param intensity 0..1 slide strength */
  setSkid(intensity: number): void {
    if (!this.ctx || !this.skidGain || !this.skidFilter) return;
    const now = this.ctx.currentTime;
    this.skidGain.gain.setTargetAtTime(intensity * 0.16, now, 0.06);
    this.skidFilter.frequency.setTargetAtTime(1250 + intensity * 1400, now, 0.08);
  }

  /** Short synthesised blip. Used for UI, countdown and boost. */
  blip(frequency: number, duration = 0.12, type: OscillatorType = 'square', gain = 0.14): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  boostWhoosh(): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.28);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.11, now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    osc.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  impact(strength: number): void {
    this.blip(90 + strength * 40, 0.16, 'triangle', Math.min(0.2, 0.06 + strength * 0.12));
  }

  dispose(): void {
    try {
      this.engineA?.stop();
      this.engineB?.stop();
      this.skidSource?.stop();
      void this.ctx?.close();
    } catch {
      /* context may already be closed */
    }
    this.ctx = null;
    this.started = false;
  }
}
