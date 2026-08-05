import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiRoot = document.querySelector<HTMLElement>('#app');
const loading = document.querySelector<HTMLElement>('#loading');

if (!canvas || !uiRoot) {
  throw new Error('Missing #game-canvas or #app element.');
}

const game = new Game(canvas, uiRoot);

game
  .start()
  .then(() => {
    loading?.remove();
  })
  .catch((error: unknown) => {
    console.error('[arcade-racer] failed to start', error);
    if (loading) {
      loading.innerHTML =
        '<p style="max-width:32ch;text-align:center;line-height:1.5">Sorry — this game could not start. Your browser may not support WebGL.</p>';
    }
  });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
