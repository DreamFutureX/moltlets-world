// ============================================================
// Moltlets Town - Engine Initialization (ensures singleton start)
// ============================================================

import { gameLoop } from './GameLoop';

// Auto-start engine on first import
if (!gameLoop.isRunning) {
  gameLoop.start();
}

export { gameLoop };
export { world } from './World';
export { eventBus } from './EventBus';

// Graceful shutdown — flush events and stop game loop before Railway kills the process
const shutdown = () => {
  console.log('[Shutdown] Signal received, flushing...');
  try {
    gameLoop.stop();
    const { eventBus: bus } = require('./EventBus');
    bus.stop();
  } catch { /* already stopped */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
