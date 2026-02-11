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
