/**
 * Portal SDK adapter (CrazyGames).
 *
 * Every call is defensive: the SDK only exists when the game is served inside
 * the portal, and the same build has to run on itch.io, a plain static host and
 * `npm run dev`. A missing SDK degrades to no-ops, never to a crash.
 *
 * Ad placement follows the PRD: no preroll, no banners. The first race is
 * always clean — "click and you are driving" is the entire advantage a web game
 * has, and spending it on an impression before the player has any reason to
 * care is how you trade retention for a few cents.
 */

interface CrazySdk {
  init?: () => Promise<void>;
  game?: {
    loadingStart?: () => void;
    loadingStop?: () => void;
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    happytime?: () => void;
  };
  ad?: {
    requestAd?: (
      type: 'midgame' | 'rewarded',
      callbacks: { adFinished?: () => void; adError?: (error: unknown) => void; adStarted?: () => void },
    ) => void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazySdk };
  }
}

/** Races between interstitials. */
const RACES_PER_AD = 3;
/** Hard floor between two interstitials, seconds. */
const MIN_AD_INTERVAL = 90;

export class Portal {
  private sdk: CrazySdk | null = null;
  private ready = false;
  private lastAdAt = -Infinity;
  private racesSinceAd = 0;
  private adInFlight = false;

  /** Set while an ad is on screen so the game can mute and pause. */
  onAdStateChange: ((showing: boolean) => void) | null = null;

  get available(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return;
    this.sdk = sdk;
    try {
      await sdk.init?.();
      this.ready = true;
    } catch {
      this.sdk = null;
      this.ready = false;
    }
  }

  loadingStart(): void {
    try { this.sdk?.game?.loadingStart?.(); } catch { /* non-fatal */ }
  }

  loadingStop(): void {
    try { this.sdk?.game?.loadingStop?.(); } catch { /* non-fatal */ }
  }

  gameplayStart(): void {
    try { this.sdk?.game?.gameplayStart?.(); } catch { /* non-fatal */ }
  }

  gameplayStop(): void {
    try { this.sdk?.game?.gameplayStop?.(); } catch { /* non-fatal */ }
  }

  /** Signals a genuinely good moment (record lap) for portal analytics. */
  happytime(): void {
    try { this.sdk?.game?.happytime?.(); } catch { /* non-fatal */ }
  }

  /**
   * Count a finished race and show an interstitial if it is due.
   * Returns true when an ad was requested, so the caller can delay its own UI.
   */
  maybeShowInterstitial(now: number, onDone: () => void): boolean {
    this.racesSinceAd += 1;

    const due = this.racesSinceAd >= RACES_PER_AD;
    const cooledDown = now - this.lastAdAt >= MIN_AD_INTERVAL;
    if (!this.ready || !due || !cooledDown || this.adInFlight) return false;

    this.racesSinceAd = 0;
    this.lastAdAt = now;
    this.requestAd('midgame', onDone, onDone);
    return true;
  }

  /** Rewarded ad. `onReward` only fires when the ad actually completed. */
  requestReward(onReward: () => void, onFail: () => void): void {
    if (!this.ready || this.adInFlight) {
      onFail();
      return;
    }
    this.requestAd('rewarded', onReward, onFail);
  }

  private requestAd(type: 'midgame' | 'rewarded', onSuccess: () => void, onFail: () => void): void {
    const request = this.sdk?.ad?.requestAd;
    if (!request) {
      onFail();
      return;
    }

    this.adInFlight = true;
    this.onAdStateChange?.(true);

    // The SDK is third-party code; if it never calls back we must not leave the
    // game paused forever behind a blank overlay.
    const timeout = window.setTimeout(() => finish(onFail), 20000);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      this.adInFlight = false;
      this.onAdStateChange?.(false);
      callback();
    };

    try {
      request(type, {
        adFinished: () => finish(onSuccess),
        adError: () => finish(onFail),
      });
    } catch {
      finish(onFail);
    }
  }
}
