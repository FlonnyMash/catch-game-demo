import Phaser from 'phaser';
import { PlayScene } from './game/scenes/PlayScene';
import { mountGameOverlays } from './ui/overlayLayout';
import { setupUIManager } from './ui/UIManager';
import './style.css';

interface RuntimeConfig {
  game: {
    width: number;
    height: number;
    backgroundColor: string;
    parentElementId: string;
  };
}

const loadConfig = async (): Promise<Record<string, unknown>> => {
  const response = await fetch('/config.json');
  if (!response.ok) {
    throw new Error(`Failed to load config.json: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
};

const getRuntimeConfig = (config: Record<string, unknown>): RuntimeConfig => {
  const game = config.game as RuntimeConfig['game'] | undefined;
  if (
    !game ||
    typeof game.width !== 'number' ||
    typeof game.height !== 'number' ||
    typeof game.backgroundColor !== 'string' ||
    typeof game.parentElementId !== 'string'
  ) {
    throw new Error('Invalid config.game section. Check public/config.json.');
  }

  return { game };
};

const bootstrapGame = async (): Promise<void> => {
  const config = await loadConfig();
  const runtimeConfig = getRuntimeConfig(config);

  const phaserConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: runtimeConfig.game.parentElementId,
    width: runtimeConfig.game.width,
    height: runtimeConfig.game.height,
    backgroundColor: runtimeConfig.game.backgroundColor,
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    callbacks: {
      preBoot: (game) => {
        game.registry.set('config', config);
      },
    },
    scene: [PlayScene],
  };

  const game = new Phaser.Game(phaserConfig);
  mountGameOverlays(game);
  setupUIManager(game);
};

void bootstrapGame();
