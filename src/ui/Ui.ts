import { TRACKS, type TrackDef } from '../data/tracks';
import { CARS, type CarDef } from '../data/cars';
import { formatTime, formatDelta } from '../systems/LapTimer';
import type { Save } from '../systems/Save';
import type { QualityTier } from '../core/Quality';

/**
 * All screens and the HUD.
 *
 * The UI owns no game state — it renders what it is handed and reports intent
 * through callbacks. That keeps the race loop free of DOM logic and means the
 * HUD can be updated at render rate while the simulation stays on its own
 * fixed clock.
 */

export interface UiCallbacks {
  onStart: (carId: string, trackId: string) => void;
  onRestart: () => void;
  onResume: () => void;
  onQuit: () => void;
  onQualityChange: (quality: 'auto' | QualityTier) => void;
  onMuteToggle: () => void;
  onPauseRequest: () => void;
  /** Fired when the menu selection changes, so the backdrop can be rebuilt. */
  onSelectionChange: (carId: string, trackId: string) => void;
}

export interface HudState {
  lap: number;
  totalLaps: number;
  speedKph: number;
  lapTime: number;
  bestTime: number;
  delta: number | null;
  boost: number;
  boostMax: number;
  driftPending: number;
  driftMultiplier: number;
  driftTotal: number;
  drifting: boolean;
  offTrack: boolean;
}

export interface ResultState {
  trackName: string;
  /** Best single lap of the race — this is the score that counts. */
  lapTime: number;
  /** Sum of all laps, shown for context only. */
  totalTime: number;
  laps: Array<{ time: number; valid: boolean }>;
  bestTime: number;
  isRecord: boolean;
  valid: boolean;
  driftScore: number;
  sectors: number[];
  targets: [number, number, number];
  unlockedCarName: string | null;
}

export class Ui {
  private readonly root: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly touch: HTMLElement;
  private readonly diagnostics: HTMLElement;

  // Cached HUD nodes: querying these every frame would be the single most
  // wasteful thing in the render path.
  private readonly el: Record<string, HTMLElement> = {};

  private selectedCar: string;
  private selectedTrack: string;
  private bannerTimer = 0;
  private lastDeltaClass = '';

  constructor(
    container: HTMLElement,
    private readonly save: Save,
    private readonly callbacks: UiCallbacks,
  ) {
    this.root = container;
    this.selectedCar = save.raw.selectedCar;
    this.selectedTrack = save.raw.selectedTrack;

    this.hud = this.buildHud();
    this.touch = this.buildTouchControls();
    this.overlay = document.createElement('div');
    this.overlay.className = 'layer';
    this.overlay.id = 'overlay';

    this.diagnostics = document.createElement('div');
    this.diagnostics.id = 'diagnostics';
    this.diagnostics.classList.add('hidden');

    this.root.append(this.hud, this.touch, this.overlay, this.diagnostics);
    this.showMenu();
  }

  // ------------------------------------------------------------------ HUD --

  private buildHud(): HTMLElement {
    const hud = document.createElement('div');
    hud.className = 'layer';
    hud.id = 'hud';
    hud.innerHTML = `
      <div class="hud-top-left">
        <div class="label">Lap <span id="lap-count">1/3</span></div>
        <div id="lap-time">0:00.000</div>
        <div id="best-time">Best --:--.---</div>
        <div id="delta"></div>
      </div>
      <div class="hud-top-right" id="drift-wrap">
        <div id="drift-score"></div>
        <div id="drift-multiplier"></div>
        <div id="drift-total"></div>
      </div>
      <div class="hud-bottom-right">
        <div id="speed-value">0</div>
        <div id="speed-unit">KM/H</div>
        <div id="boost-track"><div id="boost-fill"></div></div>
      </div>
      <div id="banner"></div>
      <div id="offtrack-warning">Off track</div>
      <button id="pause-button" type="button" aria-label="Pause">II</button>
    `;

    for (const id of [
      'lap-time', 'lap-count', 'best-time', 'delta', 'drift-score', 'drift-multiplier',
      'drift-total', 'speed-value', 'boost-track', 'boost-fill', 'banner',
      'offtrack-warning',
    ]) {
      this.el[id] = hud.querySelector(`#${id}`) as HTMLElement;
    }

    hud.querySelector('#pause-button')!.addEventListener('click', () => {
      this.callbacks.onPauseRequest();
    });

    hud.classList.add('hidden');
    return hud;
  }

  updateHud(state: HudState): void {
    const lapText = `${state.lap}/${state.totalLaps}`;
    if (this.el['lap-count'].textContent !== lapText) this.el['lap-count'].textContent = lapText;
    this.el['lap-time'].textContent = formatTime(state.lapTime);
    this.el['best-time'].textContent = Number.isFinite(state.bestTime)
      ? `Best ${formatTime(state.bestTime)}`
      : 'Best --:--.---';

    const deltaEl = this.el['delta'];
    if (state.delta === null) {
      if (deltaEl.textContent !== '') deltaEl.textContent = '';
      if (this.lastDeltaClass !== '') {
        deltaEl.className = '';
        this.lastDeltaClass = '';
      }
    } else {
      deltaEl.textContent = formatDelta(state.delta);
      const cls = state.delta <= 0 ? 'ahead' : 'behind';
      if (cls !== this.lastDeltaClass) {
        deltaEl.className = cls;
        this.lastDeltaClass = cls;
      }
    }

    this.el['speed-value'].textContent = Math.round(state.speedKph).toString();

    const boostPct = state.boostMax > 0 ? (state.boost / state.boostMax) * 100 : 0;
    (this.el['boost-fill'] as HTMLElement).style.width = `${boostPct.toFixed(1)}%`;
    this.el['boost-track'].classList.toggle('ready', boostPct > 55);

    const scoreEl = this.el['drift-score'];
    if (state.drifting && state.driftPending > 0) {
      scoreEl.textContent = `+${Math.round(state.driftPending)}`;
      scoreEl.classList.add('active');
      this.el['drift-multiplier'].textContent = state.driftMultiplier > 1 ? `x${state.driftMultiplier}` : '';
    } else {
      scoreEl.classList.remove('active');
      this.el['drift-multiplier'].textContent = '';
    }
    this.el['drift-total'].textContent = state.driftTotal > 0 ? `${state.driftTotal} pts` : '';

    this.el['offtrack-warning'].classList.toggle('show', state.offTrack);
  }

  /** Transient centre-screen message: countdown, "GO", lap banked, boost. */
  showBanner(text: string, seconds = 1, color?: string): void {
    const banner = this.el['banner'];
    banner.textContent = text;
    banner.style.color = color ?? '';
    banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  tickBanner(dt: number): void {
    if (this.bannerTimer <= 0) return;
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.el['banner'].classList.remove('show');
  }

  setDiagnostics(text: string | null): void {
    if (text === null) {
      this.diagnostics.classList.add('hidden');
      return;
    }
    this.diagnostics.classList.remove('hidden');
    this.diagnostics.textContent = text;
  }

  // -------------------------------------------------------------- touch ---

  private buildTouchControls(): HTMLElement {
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.id = 'touch';
    // Glyphs, not words. "BRAKE"/"GAS" overflow their pads on a 393 px-tall
    // landscape phone and collide with each other and the speed readout;
    // symbols stay legible at any pad size and need no translation.
    layer.innerHTML = `
      <button id="touch-left" type="button" aria-label="Steer left">◀</button>
      <button id="touch-right" type="button" aria-label="Steer right">▶</button>
      <button id="touch-brake" type="button" aria-label="Brake and handbrake">▼</button>
      <button id="touch-accel" type="button" aria-label="Accelerate">▲</button>
    `;
    layer.classList.add('hidden');
    return layer;
  }

  /**
   * Wire the pads to the input controller.
   *
   * Pointer events (not touch events) so a mouse works too, and
   * `setPointerCapture` so a thumb that slides off the button still holds it —
   * losing throttle mid-corner because your thumb drifted 3 px is the most
   * common mobile control complaint.
   */
  bindTouch(state: { left: boolean; right: boolean; accel: boolean; brake: boolean; handbrake: boolean }): void {
    const bind = (id: string, key: 'left' | 'right' | 'accel' | 'brake') => {
      const button = this.touch.querySelector(`#${id}`) as HTMLElement;
      const press = (event: PointerEvent) => {
        event.preventDefault();
        state[key] = true;
        // Braking at a standstill doubles as the handbrake on touch, where
        // there is no room for a fifth button.
        if (key === 'brake') state.handbrake = true;
        button.classList.add('pressed');
        button.setPointerCapture?.(event.pointerId);
      };
      const release = (event: PointerEvent) => {
        event.preventDefault();
        state[key] = false;
        if (key === 'brake') state.handbrake = false;
        button.classList.remove('pressed');
        button.releasePointerCapture?.(event.pointerId);
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', (event) => {
        if (!button.hasPointerCapture?.(event.pointerId)) release(event);
      });
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    };

    bind('touch-left', 'left');
    bind('touch-right', 'right');
    bind('touch-accel', 'accel');
    bind('touch-brake', 'brake');
  }

  setTouchVisible(visible: boolean): void {
    this.touch.classList.toggle('hidden', !visible);
  }

  // ------------------------------------------------------------ screens ---

  private setOverlay(html: string): HTMLElement {
    this.overlay.innerHTML = html;
    this.overlay.classList.remove('hidden');
    this.hud.classList.add('hidden');
    return this.overlay;
  }

  hideOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.hud.classList.remove('hidden');
  }

  showMenu(): void {
    const carCards = CARS.map((car) => this.carCard(car)).join('');
    const trackCards = TRACKS.map((track) => this.trackCard(track)).join('');

    const panel = this.setOverlay(`
      <div class="panel">
        <h1 class="title">Drift Circuit</h1>
        <p class="subtitle">Time attack. Drift to bank boost, chain corners, beat your ghost.</p>

        <div class="section-label">Track</div>
        <div class="card-row" id="track-row">${trackCards}</div>

        <div class="section-label">Car</div>
        <div class="card-row" id="car-row">${carCards}</div>

        <button class="button wide" id="start-button" type="button">Start race</button>

        <div class="section-label">Settings</div>
        <div class="settings-row" id="quality-row">
          ${(['auto', 'low', 'medium', 'high'] as const)
            .map(
              (q) =>
                `<button class="chip ${this.save.raw.quality === q ? 'selected' : ''}" data-quality="${q}" type="button">${q}</button>`,
            )
            .join('')}
          <button class="chip ${this.save.raw.muted ? '' : 'selected'}" id="mute-chip" type="button">
            ${this.save.raw.muted ? 'Sound off' : 'Sound on'}
          </button>
        </div>

        <p class="hint">
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive ·
          <kbd>Space</kbd> handbrake · <kbd>R</kbd> restart · <kbd>Esc</kbd> pause · gamepad supported
          ${this.save.persistent ? '' : '<br><strong>Storage is blocked, so times will not be saved this session.</strong>'}
        </p>
      </div>
    `);

    panel.querySelectorAll<HTMLButtonElement>('[data-car]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        this.selectedCar = button.dataset.car!;
        this.refreshSelection(panel);
        this.callbacks.onSelectionChange(this.selectedCar, this.selectedTrack);
      });
    });

    panel.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedTrack = button.dataset.track!;
        this.refreshSelection(panel);
        this.callbacks.onSelectionChange(this.selectedCar, this.selectedTrack);
      });
    });

    panel.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
      button.addEventListener('click', () => {
        const quality = button.dataset.quality as 'auto' | QualityTier;
        this.callbacks.onQualityChange(quality);
        panel.querySelectorAll('[data-quality]').forEach((b) => b.classList.remove('selected'));
        button.classList.add('selected');
      });
    });

    panel.querySelector('#mute-chip')!.addEventListener('click', (event) => {
      this.callbacks.onMuteToggle();
      const chip = event.currentTarget as HTMLElement;
      const muted = this.save.raw.muted;
      chip.textContent = muted ? 'Sound off' : 'Sound on';
      chip.classList.toggle('selected', !muted);
    });

    panel.querySelector('#start-button')!.addEventListener('click', () => {
      this.callbacks.onStart(this.selectedCar, this.selectedTrack);
    });
  }

  private refreshSelection(panel: HTMLElement): void {
    panel.querySelectorAll<HTMLButtonElement>('[data-car]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.car === this.selectedCar);
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.track === this.selectedTrack);
    });
  }

  private carCard(car: CarDef): string {
    const unlocked = this.save.isCarUnlocked(car.id);
    const swatch = `#${car.colors.body.toString(16).padStart(6, '0')}`;
    const lockText = car.unlock
      ? `Locked · beat ${formatTime(car.unlock.seconds)} on ${TRACKS.find((t) => t.id === car.unlock!.trackId)?.name ?? car.unlock.trackId}`
      : '';
    return `
      <button class="card ${this.selectedCar === car.id ? 'selected' : ''}" data-car="${car.id}"
              type="button" ${unlocked ? '' : 'disabled'}>
        <div class="card-name"><span class="swatch" style="background:${swatch}"></span>${car.name}</div>
        <div class="card-blurb">${car.blurb}</div>
        ${unlocked ? '' : `<div class="card-lock">${lockText}</div>`}
      </button>
    `;
  }

  private trackCard(track: TrackDef): string {
    const best = this.save.bestLap(track.id);
    const pips = [1, 2, 3]
      .map((n) => `<span class="pip ${n <= track.difficulty ? 'on' : ''}"></span>`)
      .join('');
    return `
      <button class="card ${this.selectedTrack === track.id ? 'selected' : ''}" data-track="${track.id}" type="button">
        <div class="card-name">${track.name}<span class="difficulty">${pips}</span></div>
        <div class="card-blurb">${track.blurb}</div>
        <div class="card-meta">${Number.isFinite(best) ? `Best ${formatTime(best)}` : 'No time yet'}</div>
      </button>
    `;
  }

  showPause(): void {
    const panel = this.setOverlay(`
      <div class="panel">
        <h1 class="title">Paused</h1>
        <p class="subtitle">Take your time.</p>
        <div class="button-row">
          <button class="button" id="resume" type="button">Resume</button>
          <button class="button secondary" id="restart" type="button">Restart lap</button>
          <button class="button secondary" id="quit" type="button">Change track</button>
        </div>
      </div>
    `);
    panel.querySelector('#resume')!.addEventListener('click', () => this.callbacks.onResume());
    panel.querySelector('#restart')!.addEventListener('click', () => this.callbacks.onRestart());
    panel.querySelector('#quit')!.addEventListener('click', () => this.callbacks.onQuit());
  }

  showResults(result: ResultState): void {
    const [gold, silver, bronze] = result.targets;
    const medal = (name: string, target: number) =>
      `<span class="medal ${result.valid && result.lapTime <= target ? 'earned' : ''}">${name} ${formatTime(target)}</span>`;

    // Mark which lap was the best so the player can see where the time came from.
    const fastestIndex = result.laps.reduce(
      (best, lap, i) => (lap.valid && lap.time < (result.laps[best]?.time ?? Infinity) ? i : best),
      result.laps.findIndex((lap) => lap.valid),
    );

    const lapCells = result.laps
      .map(
        (lap, i) => `
        <div class="result-cell">
          <div class="label">Lap ${i + 1}${i === fastestIndex ? ' · best' : ''}</div>
          <div class="result-value ${i === fastestIndex ? 'gold' : ''}">${
            lap.valid ? formatTime(lap.time) : 'invalid'
          }</div>
        </div>`,
      )
      .join('');

    const panel = this.setOverlay(`
      <div class="panel">
        <h1 class="title">${result.valid ? (result.isRecord ? 'New record' : 'Race complete') : 'No valid lap'}</h1>
        <p class="subtitle">${result.trackName}${
          result.valid ? '' : ' · every lap missed a sector or was reset'
        }</p>

        <div class="result-grid">
          <div class="result-cell">
            <div class="label">Best lap</div>
            <div class="result-value ${result.isRecord ? 'gold' : ''}">${formatTime(result.lapTime)}</div>
          </div>
          <div class="result-cell">
            <div class="label">Total</div>
            <div class="result-value">${formatTime(result.totalTime)}</div>
          </div>
          <div class="result-cell">
            <div class="label">Record</div>
            <div class="result-value">${Number.isFinite(result.bestTime) ? formatTime(result.bestTime) : '--:--.---'}</div>
          </div>
          <div class="result-cell">
            <div class="label">Drift score</div>
            <div class="result-value">${result.driftScore}</div>
          </div>
        </div>

        <div class="result-grid">${lapCells}</div>

        <div class="medal-row">
          ${medal('Gold', gold)}${medal('Silver', silver)}${medal('Bronze', bronze)}
        </div>

        ${result.unlockedCarName ? `<div class="toast">Unlocked: ${result.unlockedCarName}</div>` : ''}

        <div class="button-row">
          <button class="button" id="again" type="button">Race again</button>
          <button class="button secondary" id="menu" type="button">Change track</button>
        </div>
      </div>
    `);
    panel.querySelector('#again')!.addEventListener('click', () => this.callbacks.onRestart());
    panel.querySelector('#menu')!.addEventListener('click', () => this.callbacks.onQuit());
  }

  get selection(): { car: string; track: string } {
    return { car: this.selectedCar, track: this.selectedTrack };
  }
}
