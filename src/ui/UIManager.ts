import type Phaser from 'phaser';
import { bindTouchControls } from './touchControls';

export type UIState = 'START' | 'PLAYING' | 'GAMEOVER';

const PANEL_BY_STATE: Record<UIState, string> = {
  START: 'ui-start',
  PLAYING: 'ui-hud',
  GAMEOVER: 'ui-gameover',
};

export class UIManager {
  private state: UIState = 'START';
  private readonly root: HTMLElement;
  private readonly panels: Record<UIState, HTMLElement>;
  private readonly touchZone: HTMLElement;
  private readonly hudScore: HTMLElement;
  private readonly hudTimer: HTMLElement;
  private readonly finalScore: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly leadForm: HTMLFormElement;
  private readonly emailInput: HTMLInputElement;

  constructor(root: HTMLElement) {
    this.root = root;

    const start = document.getElementById('ui-start');
    const hud = document.getElementById('ui-hud');
    const gameover = document.getElementById('ui-gameover');
    const touchZone = document.getElementById('touch-zone');
    const hudScore = document.getElementById('hud-score');
    const hudTimer = document.getElementById('hud-timer');
    const finalScore = document.getElementById('final-score');
    const playButton = document.getElementById('btn-play');
    const retryButton = document.getElementById('btn-retry');
    const leadForm = document.getElementById('lead-form');
    const emailInput = document.getElementById('lead-email');

    if (
      !start ||
      !hud ||
      !gameover ||
      !touchZone ||
      !hudScore ||
      !hudTimer ||
      !finalScore ||
      !(playButton instanceof HTMLButtonElement) ||
      !(retryButton instanceof HTMLButtonElement) ||
      !(leadForm instanceof HTMLFormElement) ||
      !(emailInput instanceof HTMLInputElement)
    ) {
      throw new Error('UIManager: required DOM elements are missing from #ui-layer.');
    }

    this.panels = {
      START: start,
      PLAYING: hud,
      GAMEOVER: gameover,
    };
    this.touchZone = touchZone;
    this.hudScore = hudScore;
    this.hudTimer = hudTimer;
    this.finalScore = finalScore;
    this.playButton = playButton;
    this.retryButton = retryButton;
    this.leadForm = leadForm;
    this.emailInput = emailInput;

    this.setState('START');
  }

  getState(): UIState {
    return this.state;
  }

  setState(next: UIState): void {
    this.state = next;

    (Object.keys(PANEL_BY_STATE) as UIState[]).forEach((key) => {
      const panel = this.panels[key];
      const isActive = key === next;
      panel.classList.toggle('hidden', !isActive);

      if (key === 'GAMEOVER') {
        panel.classList.toggle('flex', isActive);
      }
    });

    const isPlaying = next === 'PLAYING';
    this.touchZone.classList.toggle('hidden', !isPlaying);
    this.touchZone.classList.toggle('touch-zone--active', isPlaying);
    this.touchZone.setAttribute('aria-hidden', isPlaying ? 'false' : 'true');

    this.root.setAttribute('data-ui-state', next);
  }

  updateScore(score: number): void {
    const value = String(Math.max(0, score));
    this.hudScore.textContent = value;
    this.finalScore.textContent = value;
  }

  updateTimer(secondsRemaining: number): void {
    const clamped = Math.max(0, Math.ceil(secondsRemaining));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    this.hudTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  resetLeadForm(): void {
    this.leadForm.reset();
  }

  bindPlay(handler: () => void): void {
    this.playButton.addEventListener('click', handler);
  }

  bindRetry(handler: () => void): void {
    this.retryButton.addEventListener('click', handler);
  }

  bindLeadSubmit(handler: (email: string) => void): void {
    this.leadForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = this.emailInput.value.trim();
      if (!email) {
        return;
      }
      handler(email);
    });
  }
}

export const setupUIManager = (game: Phaser.Game): UIManager => {
  const root = document.getElementById('ui-layer');
  if (!root) {
    throw new Error('setupUIManager: #ui-layer element not found.');
  }

  const ui = new UIManager(root);

  const requestPlay = (): void => {
    game.events.emit('uiPlayRequested');
  };

  ui.bindPlay(requestPlay);
  ui.bindRetry(requestPlay);

  ui.bindLeadSubmit((email) => {
    game.events.emit('leadSubmitted', { email });
  });

  game.events.on('gameStarted', () => {
    ui.setState('PLAYING');
  });

  game.events.on('scoreUpdated', (score: number) => {
    ui.updateScore(score);
  });

  game.events.on('timerUpdated', (secondsRemaining: number) => {
    ui.updateTimer(secondsRemaining);
  });

  game.events.on('gameOver', (payload: { score: number }) => {
    ui.updateScore(payload.score);
    ui.resetLeadForm();
    ui.setState('GAMEOVER');
  });

  const touchZone = document.getElementById('touch-zone');
  if (!touchZone) {
    throw new Error('setupUIManager: #touch-zone element not found.');
  }

  bindTouchControls(game, touchZone);

  return ui;
};
