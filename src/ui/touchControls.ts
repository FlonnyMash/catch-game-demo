import type Phaser from 'phaser';

export const PLAYER_TOUCH_EVENT = 'playerTouch';

export interface PlayerTouchPayload {
  gameX: number;
  active: boolean;
}

export const bindTouchControls = (game: Phaser.Game, touchZone: HTMLElement): (() => void) => {
  let tracking = false;

  const clientToGameX = (clientX: number): number => {
    const rect = game.canvas.getBoundingClientRect();
    if (rect.width <= 0) {
      return 0;
    }

    return ((clientX - rect.left) / rect.width) * game.scale.width;
  };

  const emitTouch = (clientX: number, active: boolean): void => {
    const payload: PlayerTouchPayload = { gameX: clientToGameX(clientX), active };
    game.events.emit(PLAYER_TOUCH_EVENT, payload);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    tracking = true;
    touchZone.setPointerCapture(event.pointerId);
    emitTouch(event.clientX, true);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!tracking) {
      return;
    }

    emitTouch(event.clientX, true);
  };

  const endPointer = (event: PointerEvent): void => {
    if (!tracking) {
      return;
    }

    tracking = false;
    if (touchZone.hasPointerCapture(event.pointerId)) {
      touchZone.releasePointerCapture(event.pointerId);
    }

    emitTouch(event.clientX, false);
  };

  const onTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
    if (!tracking || event.touches.length === 0) {
      return;
    }

    emitTouch(event.touches[0].clientX, true);
  };

  touchZone.addEventListener('pointerdown', onPointerDown);
  touchZone.addEventListener('pointermove', onPointerMove);
  touchZone.addEventListener('pointerup', endPointer);
  touchZone.addEventListener('pointercancel', endPointer);
  touchZone.addEventListener('lostpointercapture', endPointer);
  touchZone.addEventListener('touchmove', onTouchMove, { passive: false });

  return () => {
    touchZone.removeEventListener('pointerdown', onPointerDown);
    touchZone.removeEventListener('pointermove', onPointerMove);
    touchZone.removeEventListener('pointerup', endPointer);
    touchZone.removeEventListener('pointercancel', endPointer);
    touchZone.removeEventListener('lostpointercapture', endPointer);
    touchZone.removeEventListener('touchmove', onTouchMove);
  };
};
