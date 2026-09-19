import './styles.css';
import { Game } from './game/Game';

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          (canvas.getContext as any)('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function start(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const fallbackOverlay = document.getElementById('webgl-fallback');
  const contextLostOverlay = document.getElementById('context-lost-overlay');
  const contextLostMsg = document.getElementById('context-lost-msg');

  if (!canvas) {
    console.error('Night Ride canvas not found.');
    return;
  }

  if (!isWebGLAvailable()) {
    if (fallbackOverlay) fallbackOverlay.hidden = false;
    return;
  }

  let game: Game | null = null;

  try {
    game = new Game(canvas);
    (window as any).__game = game;
  } catch (err) {
    console.error('Failed to initialize Night Ride WebGL:', err);
    if (fallbackOverlay) fallbackOverlay.hidden = false;
    return;
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (game) {
      game.pause();
    }
    if (contextLostOverlay) {
      contextLostOverlay.hidden = false;
    }
  });

  canvas.addEventListener('webglcontextrestored', () => {
    if (contextLostMsg) {
      contextLostMsg.textContent = 'Graphics context restored. Reloading Night Ride...';
    }
    setTimeout(() => {
      window.location.reload();
    }, 400);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
