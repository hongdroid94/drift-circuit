import * as THREE from 'three';
import { Loop, FIXED_DT } from '../core/Loop';
import { createRenderer, applyQuality, resizeRenderer } from '../core/Renderer';
import { InputController } from '../core/InputController';
import { QualityManager, guessInitialTier, isProbablyMobile, settingsFor, type QualitySettings, type QualityTier } from '../core/Quality';
import { Vehicle, type VehicleSnapshot } from '../entities/Vehicle';
import { createCarModel, type CarModelParts } from '../entities/CarModel';
import { Track } from '../systems/Track';
import { World } from '../systems/World';
import { CameraRig } from '../systems/CameraRig';
import { LapTimer } from '../systems/LapTimer';
import { DriftScorer } from '../systems/DriftScorer';
import { GhostRecorder, GhostPlayer, type GhostData } from '../systems/Ghost';
import { SkidMarks, SmokePuffs } from '../systems/Effects';
import { AudioSystem } from '../systems/AudioSystem';
import { Save } from '../systems/Save';
import { Portal } from '../systems/Portal';
import { Autopilot } from '../systems/Autopilot';
import { Ui } from '../ui/Ui';
import { trackById } from '../data/tracks';
import { carById, CARS } from '../data/cars';
import { installTestHooks, publishDiagnostics, testHooksEnabled, type GameDiagnostics } from './TestHooks';

type Phase = 'menu' | 'countdown' | 'racing' | 'paused' | 'results';

const COUNTDOWN_SECONDS = 3;

/**
 * Laps per race.
 *
 * A single lap of the shortest circuit is ~23 s, which is too short to be a
 * session — the player is back in a menu before they have settled into the car.
 * Three laps puts a race at roughly 70-120 s, gives a standing-start warm-up
 * lap plus two flying laps, and means the ghost has something to chase from lap
 * two onward. The record is the best single lap; total time is shown but is not
 * what unlocks anything.
 */
const RACE_LAPS = 3;

/**
 * Game orchestrator.
 *
 * Owns the scene, the phase machine and the update order. The order is fixed
 * and deliberate: input -> vehicle -> lap/drift -> effects -> camera -> render.
 * Camera runs after the vehicle so it never lags a frame behind, and effects
 * run before the camera so a boost kick and its shake land on the same frame.
 */
export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly loop: Loop;

  private readonly input = new InputController();
  private readonly cameraRig: CameraRig;
  private readonly lapTimer = new LapTimer();
  private readonly drift = new DriftScorer();
  private readonly ghostRecorder = new GhostRecorder();
  private readonly ghostPlayer = new GhostPlayer();
  private readonly audio = new AudioSystem();
  private readonly save = new Save();
  private readonly portal = new Portal();
  private readonly quality: QualityManager;
  private readonly ui: Ui;

  private settings: QualitySettings;
  private track: Track | null = null;
  private world: World | null = null;
  private vehicle: Vehicle | null = null;
  private carModel: CarModelParts | null = null;
  private skidMarks: SkidMarks;
  private smoke: SmokePuffs;

  private phase: Phase = 'menu';
  private countdown = 0;
  private elapsed = 0;
  private adPaused = false;
  private diagnosticsOn = false;

  /** Laps closed in the current race, in order. */
  private raceLaps: Array<{ time: number; sectors: number[]; valid: boolean; drift: number }> = [];
  private bestLapTime = Infinity;
  private bestLapGhost: GhostData | null = null;
  private bestLapDrift = 0;

  private readonly view: VehicleSnapshot = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  private wheelSpin = 0;
  private lastBoostBank = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const savedQuality = this.save.raw.quality;
    const initialTier: QualityTier = savedQuality === 'auto' ? guessInitialTier() : savedQuality;
    this.settings = settingsFor(initialTier);

    this.camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.35, 1200);
    this.renderer = createRenderer(canvas, this.settings);
    this.cameraRig = new CameraRig(this.camera);

    this.quality = new QualityManager(initialTier, (settings) => this.onQualityChanged(settings));
    if (savedQuality !== 'auto') this.quality.setManual(savedQuality);

    this.skidMarks = new SkidMarks(this.settings);
    this.smoke = new SmokePuffs(this.settings);
    this.scene.add(this.skidMarks.mesh, this.smoke.points, this.ghostPlayer.mesh);

    this.ui = new Ui(uiRoot, this.save, {
      onStart: (carId, trackId) => void this.startRace(carId, trackId),
      onRestart: () => void this.restart(),
      onResume: () => this.resume(),
      onQuit: () => this.quitToMenu(),
      onQualityChange: (q) => this.setQuality(q),
      onMuteToggle: () => this.toggleMute(),
      onPauseRequest: () => this.pause(),
      onSelectionChange: (carId, trackId) => this.showAttract(carId, trackId),
    });
    this.ui.bindTouch(this.input.touch);
    this.ui.setTouchVisible(false);

    this.input.onAction = (action) => {
      if (action === 'restart' && (this.phase === 'racing' || this.phase === 'paused')) void this.restart();
      if (action === 'pause') this.togglePause();
    };

    this.portal.onAdStateChange = (showing) => {
      this.adPaused = showing;
      this.audio.setMuted(showing || this.save.raw.muted);
    };

    this.loop = new Loop(
      (dt) => this.fixedUpdate(dt),
      (alpha, frameDelta) => this.render(alpha, frameDelta),
    );

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('orientationchange', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('keydown', this.handleDebugKey);

    // Audio needs a real gesture; the first click or key anywhere unlocks it.
    const unlock = () => {
      void this.audio.unlock().then(() => this.audio.setMuted(this.save.raw.muted));
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    if (testHooksEnabled) this.installHooks();
  }

  private installHooks(): void {
    installTestHooks({
      setState: (state) => {
        if (state === 'menu') {
          this.quitToMenu();
          return true;
        }
        if (state === 'racing') {
          const { car, track } = this.ui.selection;
          void this.startRace(car, track);
          // Skip the countdown so automated capture does not have to sleep
          // through it and guess when the race actually began.
          this.countdown = 0;
          this.lastCountdownShown = -1;
          this.beginLap();
          return true;
        }
        if (state === 'results') {
          if (this.phase !== 'racing') return false;
          // Jump straight to the finish rather than closing one lap, so capture
          // tooling does not have to drive two more laps to reach this screen.
          this.raceLaps.push({
            time: this.lapTimer.current,
            sectors: [1, 1, 1],
            valid: false,
            drift: this.drift.total,
          });
          this.finishRace();
          return true;
        }
        return false;
      },
      seed: () => {
        // Scenery placement is already seeded per track definition, so a run is
        // reproducible without any extra state. Nothing to do.
      },
      setPausedForScreenshot: (paused) => {
        // Reuses the ad-pause path: simulation stops, rendering continues.
        this.adPaused = paused;
      },
      setReducedMotion: (enabled) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: (hidden) => {
        this.diagnosticsOn = !hidden && this.diagnosticsOn;
        if (hidden) this.ui.setDiagnostics(null);
      },
      drive: (throttle, steer, handbrake = false) => {
        this.autopilot = null;
        this.input.scripted = { throttle, steer, handbrake };
      },
      release: () => {
        this.autopilot = null;
        this.input.scripted = null;
        this.input.reset();
      },
      setAutopilot: (enabled) => {
        if (!enabled || !this.track) {
          this.autopilot = null;
          this.input.scripted = null;
          return false;
        }
        this.autopilot = new Autopilot(this.track);
        return true;
      },

    });
  }

  private buildDiagnostics(): GameDiagnostics {
    const info = this.renderer.info;
    const v = this.vehicle;
    const canvas = this.renderer.domElement;
    return {
      frame: this.frameCount,
      elapsed: this.elapsed,
      fps: Math.round(this.loop.fps),
      phase: this.phase,
      player: {
        position: { x: v?.position.x ?? 0, y: v?.position.y ?? 0, z: v?.position.z ?? 0 },
        speed: v?.speed ?? 0,
        speedKph: v ? v.speed * 3.6 : 0,
        slipDegrees: v ? v.slipAngle * 57.2958 : 0,
        boost: v?.boost ?? 0,
        progress: v?.progress ?? 0,
        grounded: v?.grounded ?? true,
        drifting: v?.isDrifting ?? false,
      },
      lap: {
        time: this.lapTimer.current,
        best: this.track ? this.save.bestLap(this.track.def.id) : Infinity,
        driftScore: this.drift.total,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        width: canvas.width,
        height: canvas.height,
        dpr: this.renderer.getPixelRatio(),
        tier: this.settings.tier,
      },
    };
  }

  private frameCount = 0;
  private reducedMotion = false;
  private autopilot: Autopilot | null = null;

  async start(): Promise<void> {
    this.portal.loadingStart();
    await this.portal.init();
    this.handleResize();
    // Build the backdrop before the first frame so the menu never flashes on
    // an empty scene.
    const { car, track } = this.ui.selection;
    this.showAttract(car, track);
    this.portal.loadingStop();
    this.loop.start();
  }

  // ------------------------------------------------------------- phases ---

  private async startRace(carId: string, trackId: string): Promise<void> {
    this.save.setSelection(carId, trackId);
    this.buildRace(carId, trackId);

    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.ui.hideOverlay();
    this.ui.setTouchVisible(isProbablyMobile());
    this.audio.setRunning(true);
    this.portal.gameplayStart();
  }

  private buildRace(carId: string, trackId: string): void {
    this.teardownRace();

    const trackDef = trackById(trackId);
    const carDef = carById(carId);

    this.track = new Track(trackDef);
    this.world = new World(trackDef, this.track, this.scene, this.settings);
    this.scene.add(this.world.group, this.track.group);

    this.vehicle = new Vehicle(carDef);
    const start = this.track.startTransform();
    this.vehicle.reset(start.position, start.yaw);

    this.carModel = createCarModel(carDef);
    this.scene.add(this.carModel.root);

    this.raceLaps = [];
    this.bestLapTime = Infinity;
    this.bestLapGhost = null;
    this.bestLapDrift = 0;

    this.cameraRig.reset();
    this.lapTimer.reset();
    this.lapTimer.bestSectors = null;
    this.drift.resetAll();
    this.skidMarks.clear();
    this.smoke.clear();

    this.ghostPlayer.load(this.save.ghost(trackId));

    this.lapTimer.onLap = (result) => this.onLapComplete(result);
    this.lapTimer.onSector = (index, _split, delta) => {
      if (delta === null) return;
      const ahead = delta <= 0;
      this.ui.showBanner(
        `S${index + 1} ${ahead ? '' : '+'}${delta.toFixed(2)}`,
        1.1,
        ahead ? '#4ade80' : '#f87171',
      );
    };
    this.drift.onBank = (points, chain) => {
      this.ui.showBanner(`+${points}${chain > 1 ? ` x${chain}` : ''}`, 0.9, '#ffcc33');
      this.audio.blip(520 + chain * 80, 0.1, 'triangle', 0.1);
    };
  }

  private beginLap(): void {
    if (!this.vehicle) return;
    this.phase = 'racing';
    this.lapTimer.start(this.vehicle.progress);
    this.ghostRecorder.start();
    this.ghostPlayer.start();
    this.ui.showBanner('GO', 0.8, '#4ade80');
    this.audio.blip(880, 0.22, 'square', 0.16);
  }

  /**
   * One lap closed. Either roll into the next lap or end the race.
   *
   * The ghost is re-recorded every lap and only the fastest one is kept, so the
   * replay the player races next time is their best lap, not whichever lap
   * happened to be last.
   */
  private onLapComplete(result: { time: number; sectors: number[]; valid: boolean }): void {
    if (!this.track || !this.vehicle) return;

    const lapGhost = this.ghostRecorder.finish(result.time);
    const lapDrift = this.drift.total;
    this.raceLaps.push({ ...result, drift: lapDrift });

    if (result.valid && result.time < this.bestLapTime) {
      this.bestLapTime = result.time;
      this.bestLapGhost = lapGhost;
      this.bestLapDrift = lapDrift;
    }

    if (this.raceLaps.length < RACE_LAPS) {
      // Roll straight into the next lap: no pause, no banner queue collision.
      const remaining = RACE_LAPS - this.raceLaps.length;
      this.ui.showBanner(
        result.valid ? `LAP ${this.raceLaps.length + 1}/${RACE_LAPS}` : 'LAP INVALID',
        1.1,
        result.valid ? '#ffcc33' : '#f87171',
      );
      this.audio.blip(result.valid ? 660 : 300, 0.16, 'square', 0.12);
      this.drift.resetLap();
      this.ghostRecorder.start();
      // Restart the ghost so it races each lap alongside the player.
      this.ghostPlayer.start();
      if (remaining === 1) this.ui.showBanner('FINAL LAP', 1.3, '#ffcc33');
      return;
    }

    this.finishRace();
  }

  private finishRace(): void {
    if (!this.track) return;

    const trackId = this.track.def.id;
    const validLaps = this.raceLaps.filter((lap) => lap.valid);
    const anyValid = validLaps.length > 0;
    const bestTime = anyValid ? this.bestLapTime : Infinity;
    const totalTime = this.raceLaps.reduce((sum, lap) => sum + lap.time, 0);
    // Derived, not accumulated: a separate running total silently desynced
    // whenever a race ended through a path that did not add to it.
    const raceDrift = this.raceLaps.reduce((sum, lap) => sum + lap.drift, 0);

    let isRecord = false;
    if (anyValid) {
      isRecord = this.save.submitLap(trackId, bestTime, this.bestLapDrift, this.bestLapGhost);
      if (isRecord) this.portal.happytime();
    }

    const unlockedCarName = anyValid ? this.checkUnlocks(trackId, bestTime) : null;
    const result = {
      time: bestTime,
      sectors: (validLaps[0] ?? this.raceLaps[0])?.sectors ?? [],
      valid: anyValid,
    };

    this.phase = 'results';
    this.lapTimer.stop();
    this.ghostPlayer.stop();
    this.audio.setRunning(false);
    this.audio.setSkid(0);
    this.portal.gameplayStop();
    this.save.countRace();

    const showResults = () => {
      this.ui.showResults({
        trackName: this.track!.def.name,
        lapTime: result.time,
        totalTime,
        laps: this.raceLaps.map((lap) => ({ time: lap.time, valid: lap.valid })),
        bestTime: this.save.bestLap(trackId),
        isRecord,
        valid: result.valid,
        driftScore: raceDrift,
        sectors: result.sectors,
        targets: this.track!.def.targets,
        unlockedCarName,
      });
      this.ui.setTouchVisible(false);
    };

    // The interstitial, if due, plays before the results panel so the player
    // never has an ad thrown over a screen they are reading.
    if (!this.portal.maybeShowInterstitial(this.elapsed, showResults)) {
      showResults();
    }
  }

  private checkUnlocks(trackId: string, lapTime: number): string | null {
    for (const car of CARS) {
      if (!car.unlock || this.save.isCarUnlocked(car.id)) continue;
      if (car.unlock.trackId === trackId && lapTime <= car.unlock.seconds) {
        if (this.save.unlockCar(car.id)) return car.name;
      }
    }
    return null;
  }

  private async restart(): Promise<void> {
    const { car, track } = this.ui.selection;
    await this.startRace(car, track);
  }

  private pause(): void {
    if (this.phase !== 'racing') return;
    this.phase = 'paused';
    this.audio.setRunning(false);
    this.audio.setSkid(0);
    this.portal.gameplayStop();
    this.ui.showPause();
    this.ui.setTouchVisible(false);
    this.input.reset();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'racing';
    this.audio.setRunning(true);
    this.portal.gameplayStart();
    this.ui.hideOverlay();
    this.ui.setTouchVisible(isProbablyMobile());
  }

  private togglePause(): void {
    if (this.phase === 'racing') this.pause();
    else if (this.phase === 'paused') this.resume();
  }

  private quitToMenu(): void {
    this.phase = 'menu';
    this.audio.setRunning(false);
    this.audio.setSkid(0);
    this.portal.gameplayStop();
    this.ui.setTouchVisible(false);
    this.ui.showMenu();
    const { car, track } = this.ui.selection;
    this.showAttract(car, track);
  }

  /**
   * Build the selected circuit behind the menu and orbit the camera over it.
   *
   * A menu floating on a black void gives no sense of what the game is, and
   * portal curators see the first screen before they see anything else. This
   * reuses the whole race scene rather than a bespoke preview, so the backdrop
   * is literally the track you are about to drive.
   */
  private showAttract(carId: string, trackId: string): void {
    if (this.phase !== 'menu') return;
    this.buildRace(carId, trackId);
    this.attractAngle = 0;
    this.cameraRig.reset();
  }

  private attractAngle = 0;

  /** Slow orbit around the grid, with the car sitting on the start line. */
  private updateAttract(frameDelta: number): void {
    if (!this.vehicle || !this.carModel) return;
    this.attractAngle += frameDelta * 0.16;

    const target = this.vehicle.position;
    // Wide enough that the road sweeps away behind the panel rather than
    // filling the frame with tarmac.
    const radius = 27;
    const height = 9.5;
    this.camera.position.set(
      target.x + Math.sin(this.attractAngle) * radius,
      target.y + height,
      target.z + Math.cos(this.attractAngle) * radius,
    );
    this.camera.lookAt(target.x, target.y + 1.2, target.z);

    const baseFov = this.camera.aspect < 1 ? 78 : 66;
    if (Math.abs(this.camera.fov - baseFov) > 0.05) {
      this.camera.fov = baseFov;
      this.camera.updateProjectionMatrix();
    }

    this.carModel.root.position.set(target.x, target.y, target.z);
    this.carModel.root.rotation.y = this.vehicle.yaw;
    this.world?.focusShadow(this.carModel.root.position);
  }

  private teardownRace(): void {
    if (this.carModel) {
      this.scene.remove(this.carModel.root);
      this.carModel.dispose();
      this.carModel = null;
    }
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
      this.world = null;
    }
    if (this.track) {
      this.scene.remove(this.track.group);
      this.track.dispose();
      this.track = null;
    }
    this.vehicle = null;
    this.autopilot = null;
    this.ghostPlayer.stop();
    this.skidMarks.clear();
    this.smoke.clear();
  }

  // ------------------------------------------------------------- update ---

  private fixedUpdate(dt: number): void {
    this.elapsed += dt;
    if (this.adPaused) return;

    const intent = this.input.update(dt);

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const remaining = Math.ceil(this.countdown);
      if (remaining !== this.lastCountdownShown && remaining > 0) {
        this.lastCountdownShown = remaining;
        this.ui.showBanner(String(remaining), 0.9, '#ffffff');
        this.audio.blip(440, 0.14, 'square', 0.12);
      }
      // Hold the car on the grid but keep it grounded and rendered.
      if (this.vehicle && this.track) this.vehicle.fixedUpdate(dt, intent, this.track, true);
      if (this.countdown <= 0) {
        this.lastCountdownShown = -1;
        this.beginLap();
      }
      return;
    }

    if (this.phase !== 'racing' || !this.vehicle || !this.track) return;

    // Autopilot overrides real input entirely while engaged.
    const active = this.autopilot ? this.autopilot.update(this.vehicle) : intent;

    this.vehicle.fixedUpdate(dt, active, this.track);
    this.lapTimer.update(dt, this.vehicle.progress);
    this.drift.update(dt, this.vehicle);
    this.ghostRecorder.update(dt, this.vehicle);
    this.ghostPlayer.update(dt);

    if (this.vehicle.justBankedBoost > this.lastBoostBank) {
      this.audio.boostWhoosh();
      this.cameraRig.shake(0.28);
    }
    this.lastBoostBank = this.vehicle.justBankedBoost;

    this.emitEffects(dt);
    this.updateAudio();
  }

  private lastCountdownShown = -1;

  private emitEffects(dt: number): void {
    const vehicle = this.vehicle!;
    if (!vehicle.grounded) return;

    const slip = Math.abs(vehicle.slipAngle);
    const intensity = Math.min(1, (slip - vehicle.def.driftAngle * 0.6) / vehicle.def.driftAngle);
    if (intensity <= 0 || vehicle.speed < 6) {
      this.skidMarks.breakTrail(0);
      this.skidMarks.breakTrail(1);
      return;
    }

    const sinYaw = Math.sin(vehicle.yaw);
    const cosYaw = Math.cos(vehicle.yaw);
    // Rear axle, offset to each side.
    const rearX = vehicle.position.x - sinYaw * 1.28;
    const rearZ = vehicle.position.z - cosYaw * 1.28;
    const rightX = cosYaw;
    const rightZ = -sinYaw;
    const groundY = vehicle.position.y - 0.42;

    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -0.86 : 0.86;
      this.skidMarks.addPoint(
        i,
        rearX + rightX * side,
        groundY,
        rearZ + rightZ * side,
        rightX,
        rightZ,
        intensity,
      );
    }

    // Emit smoke on a time budget rather than every step, or the ring buffer
    // recycles faster than the puffs can fade and the plume flickers.
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.045;
      const side = Math.sin(this.elapsed * 31) * 0.86;
      this.smoke.emit(
        rearX + rightX * side,
        groundY + 0.22,
        rearZ + rightZ * side,
        -vehicle.velocity.x,
        -vehicle.velocity.z,
        intensity,
      );
    }
  }

  private smokeTimer = 0;

  private updateAudio(): void {
    const vehicle = this.vehicle!;
    const speedRatio = Math.min(1, vehicle.speed / vehicle.def.topSpeed);
    this.audio.updateEngine(speedRatio, this.input.intent.throttle, vehicle.boost > 0);

    const slip = Math.abs(vehicle.slipAngle);
    const skid = vehicle.grounded && vehicle.speed > 6
      ? Math.min(1, Math.max(0, (slip - vehicle.def.driftAngle * 0.5) / vehicle.def.driftAngle))
      : 0;
    this.audio.setSkid(skid);
  }

  // ------------------------------------------------------------- render ---

  private render(alpha: number, frameDelta: number): void {
    this.quality.update(frameDelta);
    this.ui.tickBanner(frameDelta);
    resizeRenderer(this.renderer, this.camera, this.settings.maxDpr);

    if (this.phase === 'menu') {
      this.updateAttract(frameDelta);
      this.smoke.update(frameDelta);
      this.renderer.render(this.scene, this.camera);
      this.frameCount += 1;
      if (testHooksEnabled) publishDiagnostics(this.buildDiagnostics());
      return;
    }

    if (this.vehicle && this.carModel) {
      this.vehicle.interpolate(alpha, this.view);

      const root = this.carModel.root;
      root.position.set(this.view.x, this.view.y, this.view.z);
      root.rotation.y = this.view.yaw;
      this.carModel.body.rotation.x = this.view.pitch;
      this.carModel.body.rotation.z = this.view.roll;

      // Wheels: spin from forward speed, front pair steers.
      this.wheelSpin += this.vehicle.forwardSpeed * frameDelta * 2.4;
      for (const wheel of this.carModel.wheels) wheel.rotation.x = this.wheelSpin;
      const steerVisual = this.input.intent.steer * 0.42;
      for (const pivot of this.carModel.steeredWheels) pivot.rotation.y = steerVisual;

      const braking = this.input.intent.throttle < -0.05;
      const brakeMat = this.carModel.brakeLights.material as THREE.MeshStandardMaterial;
      brakeMat.emissiveIntensity = braking ? 2.4 : 0.35;

      const flameMat = this.carModel.boostFlames.material as THREE.MeshBasicMaterial;
      const boosting = this.vehicle.boost > 0;
      this.carModel.boostFlames.visible = boosting;
      if (boosting) {
        // Reduced motion freezes the flicker so screenshot baselines are stable.
        const flicker = this.reducedMotion ? 0 : Math.sin(this.elapsed * 40);
        flameMat.opacity = 0.45 + flicker * 0.2;
        const scale = 0.9 + (this.reducedMotion ? 0 : Math.sin(this.elapsed * 33)) * 0.18;
        this.carModel.boostFlames.scale.set(1, scale, 1);
      }

      this.cameraRig.update(this.vehicle, this.view, frameDelta);
      this.world?.focusShadow(this.carModel.root.position);
    }

    this.smoke.update(frameDelta);

    if (this.phase === 'racing' && this.vehicle) {
      this.ui.updateHud({
        lap: Math.min(RACE_LAPS, this.raceLaps.length + 1),
        totalLaps: RACE_LAPS,
        speedKph: this.vehicle.speed * 3.6,
        lapTime: this.lapTimer.current,
        bestTime: this.track ? this.save.bestLap(this.track.def.id) : Infinity,
        delta: this.lapTimer.liveDelta(this.vehicle.progress),
        boost: this.vehicle.boost,
        boostMax: this.vehicle.def.boostMax,
        driftPending: this.drift.pending,
        driftMultiplier: this.drift.multiplier,
        driftTotal: this.drift.total,
        drifting: this.drift.active,
        offTrack: this.vehicle.offTrack,
      });
    }

    if (this.diagnosticsOn) this.updateDiagnostics();

    this.renderer.render(this.scene, this.camera);

    this.frameCount += 1;
    if (testHooksEnabled) publishDiagnostics(this.buildDiagnostics());
  }

  private updateDiagnostics(): void {
    const info = this.renderer.info;
    const lines = [
      `fps      ${this.loop.fps.toFixed(0)}`,
      `tier     ${this.settings.tier} (dpr<=${this.settings.maxDpr})`,
      `calls    ${info.render.calls}`,
      `tris     ${info.render.triangles}`,
      `progs    ${info.programs?.length ?? 0}`,
      `geoms    ${info.memory.geometries}  tex ${info.memory.textures}`,
    ];
    if (this.vehicle) {
      lines.push(
        `speed    ${(this.vehicle.speed * 3.6).toFixed(0)} km/h`,
        `slip     ${(this.vehicle.slipAngle * 57.2958).toFixed(1)}deg`,
        `boost    ${this.vehicle.boost.toFixed(2)}s`,
        `prog     ${(this.vehicle.progress * 100).toFixed(1)}%`,
        `ground   ${this.vehicle.grounded ? 'yes' : 'AIR'}`,
      );
    }
    this.ui.setDiagnostics(lines.join('\n'));
  }

  // ------------------------------------------------------------ settings --

  private onQualityChanged(settings: QualitySettings): void {
    this.settings = settings;
    applyQuality(this.renderer, settings);
    this.world?.applyQuality(settings, this.scene);
    // Particle buffers are sized per tier, so rebuild them on a change.
    this.scene.remove(this.skidMarks.mesh, this.smoke.points);
    this.skidMarks.dispose();
    this.smoke.dispose();
    this.skidMarks = new SkidMarks(settings);
    this.smoke = new SmokePuffs(settings);
    this.scene.add(this.skidMarks.mesh, this.smoke.points);
  }

  private setQuality(quality: 'auto' | QualityTier): void {
    this.save.setQuality(quality);
    if (quality === 'auto') {
      this.onQualityChanged(settingsFor(guessInitialTier()));
    } else {
      this.quality.setManual(quality);
    }
  }

  private toggleMute(): void {
    const muted = !this.save.raw.muted;
    this.save.setMuted(muted);
    this.audio.setMuted(muted);
  }

  private readonly handleResize = () => {
    resizeRenderer(this.renderer, this.camera, this.settings.maxDpr);
  };

  /** Pause automatically when the tab is hidden — a portal user switching tabs
   *  should not come back to a finished lap and a drained battery. */
  private readonly handleVisibility = () => {
    if (document.hidden && this.phase === 'racing') this.pause();
  };

  private readonly handleDebugKey = (event: KeyboardEvent) => {
    if (event.code === 'F9') {
      this.diagnosticsOn = !this.diagnosticsOn;
      if (!this.diagnosticsOn) this.ui.setDiagnostics(null);
    }
  };

  dispose(): void {
    this.loop.stop();
    this.teardownRace();
    this.input.dispose();
    this.audio.dispose();
    this.ghostPlayer.dispose();
    this.skidMarks.dispose();
    this.smoke.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('orientationchange', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('keydown', this.handleDebugKey);
  }
}

export { FIXED_DT };
