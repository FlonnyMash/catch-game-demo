import type Phaser from 'phaser';

/** Keep touch + UI as the last children of #app, above Phaser’s canvas container. */
export const mountGameOverlays = (game: Phaser.Game): void => {
  const app = document.getElementById('app');
  const touchZone = document.getElementById('touch-zone');
  const uiLayer = document.getElementById('ui-layer');

  if (!app || !touchZone || !uiLayer) {
    return;
  }

  const bringToFront = (): void => {
    app.appendChild(touchZone);
    app.appendChild(uiLayer);
  };

  bringToFront();
  requestAnimationFrame(bringToFront);
  game.events.once('ready', bringToFront);

  const observer = new MutationObserver(() => {
    if (app.lastElementChild !== uiLayer) {
      bringToFront();
    }
  });

  observer.observe(app, { childList: true });
};
