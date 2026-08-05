/**
 * Input: keyboard, on-screen touch buttons and gamepad collapse into one small
 * intent struct that the vehicle reads. Nothing else in the game looks at raw
 * key codes.
 *
 * Digital sources (keys, touch buttons) are ramped rather than applied
 * instantly. A racing game steered by a binary key feels twitchy and makes
 * drift impossible to hold; ramping gives the same analog band a stick has.
 */

export interface InputIntent {
  /** -1 full brake/reverse .. +1 full throttle. */
  throttle: number;
  /** -1 left .. +1 right. */
  steer: number;
  handbrake: boolean;
}

/** Seconds to go from centred to full lock on a digital input. */
const STEER_ATTACK = 0.16;
/** Seconds to return to centre when nothing is held. */
const STEER_RELEASE = 0.1;
const THROTTLE_ATTACK = 0.22;
const THROTTLE_RELEASE = 0.3;

const DEADZONE = 0.14;

function applyDeadzone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < DEADZONE) return 0;
  // Rescale so the usable range still spans the full 0..1 after the deadzone.
  return Math.sign(value) * ((magnitude - DEADZONE) / (1 - DEADZONE));
}

function moveToward(current: number, target: number, attack: number, release: number, dt: number): number {
  const closing = Math.abs(target) > Math.abs(current) || Math.sign(target) !== Math.sign(current);
  const rate = closing ? attack : release;
  const step = rate <= 0 ? 1 : dt / rate;
  const delta = target - current;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

export class InputController {
  readonly intent: InputIntent = { throttle: 0, steer: 0, handbrake: false };

  /** Set by the on-screen touch buttons. */
  readonly touch = { left: false, right: false, accel: false, brake: false, handbrake: false };

  /**
   * Synthetic input from test hooks. When set it overrides every real device,
   * so a bot playtest is not fighting a stray key event.
   */
  scripted: { throttle: number; steer: number; handbrake: boolean } | null = null;

  private readonly keys = new Set<string>();
  private gamepadIndex: number | null = null;
  private disposed = false;

  /** Fired on restart / pause requests so the game can react once per press. */
  onAction: ((action: 'restart' | 'pause') => void) | null = null;

  constructor(private readonly target: EventTarget = window) {
    this.target.addEventListener('keydown', this.handleKeyDown as EventListener);
    this.target.addEventListener('keyup', this.handleKeyUp as EventListener);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('gamepadconnected', this.handleGamepadConnected as EventListener);
    window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected as EventListener);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    // Arrow keys and space scroll the page otherwise, which is jarring inside a
    // portal iframe.
    if (SCROLL_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    this.keys.add(event.code);

    if (event.code === 'KeyR') this.onAction?.('restart');
    if (event.code === 'Escape' || event.code === 'KeyP') this.onAction?.('pause');
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  /** Losing focus mid-corner would otherwise leave the throttle stuck on. */
  private readonly handleBlur = () => {
    this.keys.clear();
    this.touch.left = this.touch.right = this.touch.accel = this.touch.brake = this.touch.handbrake = false;
  };

  private readonly handleGamepadConnected = (event: GamepadEvent) => {
    this.gamepadIndex = event.gamepad.index;
  };

  private readonly handleGamepadDisconnected = (event: GamepadEvent) => {
    if (this.gamepadIndex === event.gamepad.index) this.gamepadIndex = null;
  };

  private readPad(): { steer: number; throttle: number; handbrake: boolean } | null {
    if (this.gamepadIndex === null || typeof navigator.getGamepads !== 'function') return null;
    const pad = navigator.getGamepads()[this.gamepadIndex];
    if (!pad) return null;

    const steer = applyDeadzone(pad.axes[0] ?? 0);
    // Standard mapping: button 7 is RT, button 6 is LT, both analog.
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    const throttle = rt - lt;
    const handbrake = (pad.buttons[0]?.pressed ?? false) || (pad.buttons[5]?.pressed ?? false);
    return { steer, throttle, handbrake };
  }

  update(dt: number): InputIntent {
    if (this.scripted) {
      this.intent.throttle = this.scripted.throttle;
      this.intent.steer = this.scripted.steer;
      this.intent.handbrake = this.scripted.handbrake;
      return this.intent;
    }

    let targetSteer = 0;
    let targetThrottle = 0;
    let handbrake = false;
    let analog = false;

    const pad = this.readPad();
    if (pad && (pad.steer !== 0 || pad.throttle !== 0 || pad.handbrake)) {
      targetSteer = pad.steer;
      targetThrottle = pad.throttle;
      handbrake = pad.handbrake;
      analog = true;
    } else {
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.touch.left) targetSteer -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD') || this.touch.right) targetSteer += 1;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.touch.accel) targetThrottle += 1;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS') || this.touch.brake) targetThrottle -= 1;
      handbrake = this.keys.has('Space') || this.keys.has('ShiftLeft') || this.touch.handbrake;
    }

    if (analog) {
      // A real stick is already analog; smoothing it again just adds lag.
      this.intent.steer = targetSteer;
      this.intent.throttle = targetThrottle;
    } else {
      this.intent.steer = moveToward(this.intent.steer, targetSteer, STEER_ATTACK, STEER_RELEASE, dt);
      this.intent.throttle = moveToward(
        this.intent.throttle,
        targetThrottle,
        THROTTLE_ATTACK,
        THROTTLE_RELEASE,
        dt,
      );
    }

    this.intent.handbrake = handbrake;
    return this.intent;
  }

  reset(): void {
    this.intent.throttle = 0;
    this.intent.steer = 0;
    this.intent.handbrake = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.handleKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.handleKeyUp as EventListener);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('gamepadconnected', this.handleGamepadConnected as EventListener);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected as EventListener);
  }
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
