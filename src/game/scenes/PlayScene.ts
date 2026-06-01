import Phaser from 'phaser';

type ItemType = 'good' | 'bad';

interface AssetConfig {
  player: string;
  goodItems: string[];
  badItems: string[];
}

interface PhysicsConfig {
  itemSpawnRateMs: number;
  itemFallSpeedMin: number;
  itemFallSpeedMax: number;
}

interface GameplayConfig {
  durationSeconds: number;
  scorePerGoodItem: number;
  scorePerBadItem: number;
}

interface GameConfig {
  assets: AssetConfig;
  physics: PhysicsConfig;
  gameplay: GameplayConfig;
}

interface FallingItemData {
  type: ItemType;
}

const PLAYER_TEXTURE_KEY = 'player';
const GOOD_TEXTURE_PREFIX = 'item-good-';
const BAD_TEXTURE_PREFIX = 'item-bad-';

export class PlayScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private itemGroup!: Phaser.Physics.Arcade.Group;
  private config!: GameConfig;
  private minFallSpeed = 0;
  private maxFallSpeed = 0;
  private isPlaying = false;
  private score = 0;
  private timeRemaining = 0;
  private spawnTimerEvent?: Phaser.Time.TimerEvent;
  private countdownTimerEvent?: Phaser.Time.TimerEvent;
  private readonly onPlayRequested = (): void => {
    this.startRound();
  };

  constructor() {
    super('PlayScene');
  }

  preload(): void {
    this.config = this.getConfig();
    this.load.image(PLAYER_TEXTURE_KEY, this.config.assets.player);

    this.config.assets.goodItems.forEach((assetPath, index) => {
      this.load.image(`${GOOD_TEXTURE_PREFIX}${index}`, assetPath);
    });

    this.config.assets.badItems.forEach((assetPath, index) => {
      this.load.image(`${BAD_TEXTURE_PREFIX}${index}`, assetPath);
    });
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const worldBounds = this.physics.world.bounds;
    worldBounds.setTo(0, 0, width, height);

    this.player = this.physics.add.sprite(width / 2, height - 48, PLAYER_TEXTURE_KEY);
    this.player.setCollideWorldBounds(true);
    this.player.setImmovable(true);
    this.player.setGravity(0, 0);
    this.player.setVelocity(0, 0);

    this.cursors = this.input.keyboard?.createCursorKeys() ?? ({} as Phaser.Types.Input.Keyboard.CursorKeys);
    this.itemGroup = this.physics.add.group({ allowGravity: false });

    this.minFallSpeed = this.config.physics.itemFallSpeedMin;
    this.maxFallSpeed = this.config.physics.itemFallSpeedMax;
    this.timeRemaining = this.config.gameplay.durationSeconds;

    this.physics.add.overlap(
      this.player,
      this.itemGroup,
      this.handleItemCaught as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );

    this.game.events.on('uiPlayRequested', this.onPlayRequested);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('uiPlayRequested', this.onPlayRequested);
      this.clearRoundTimers();
    });

    this.emitScore();
    this.emitTimer();
  }

  update(): void {
    if (!this.isPlaying || !this.player?.active) {
      return;
    }

    const speed = 320;
    const movingLeft = this.cursors.left?.isDown ?? false;
    const movingRight = this.cursors.right?.isDown ?? false;
    const horizontalVelocity = (Number(movingRight) - Number(movingLeft)) * speed;
    this.player.setVelocityX(horizontalVelocity);

    const height = this.scale.height;
    this.itemGroup.getChildren().forEach((child) => {
      const item = child as Phaser.Physics.Arcade.Image;
      if (item.active && item.y > height + item.displayHeight) {
        item.destroy();
      }
    });
  }

  private startRound(): void {
    if (this.isPlaying) {
      return;
    }

    this.isPlaying = true;
    this.score = 0;
    this.timeRemaining = this.config.gameplay.durationSeconds;
    this.itemGroup.clear(true, true);
    this.player.setVelocityX(0);

    this.emitScore();
    this.emitTimer();
    this.game.events.emit('gameStarted');

    this.spawnTimerEvent = this.time.addEvent({
      delay: this.config.physics.itemSpawnRateMs,
      loop: true,
      callback: this.spawnItem,
      callbackScope: this,
    });

    this.countdownTimerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: this.tickTimer,
      callbackScope: this,
    });
  }

  private tickTimer(): void {
    if (!this.isPlaying) {
      return;
    }

    this.timeRemaining -= 1;
    this.emitTimer();

    if (this.timeRemaining <= 0) {
      this.endRound();
    }
  }

  private endRound(): void {
    if (!this.isPlaying) {
      return;
    }

    this.isPlaying = false;
    this.clearRoundTimers();
    this.itemGroup.clear(true, true);
    this.player.setVelocityX(0);
    this.game.events.emit('gameOver', { score: this.score });
  }

  private clearRoundTimers(): void {
    this.spawnTimerEvent?.remove();
    this.spawnTimerEvent = undefined;
    this.countdownTimerEvent?.remove();
    this.countdownTimerEvent = undefined;
  }

  private spawnItem(): void {
    if (!this.isPlaying) {
      return;
    }

    const itemType: ItemType = Phaser.Math.Between(0, 1) === 0 ? 'good' : 'bad';
    const textureKey = this.getRandomTextureKey(itemType);
    const x = Phaser.Math.Between(24, Math.max(24, this.scale.width - 24));
    const y = -16;

    const item = this.itemGroup.create(x, y, textureKey) as Phaser.Physics.Arcade.Image | null;
    if (!item) {
      return;
    }

    item.setActive(true);
    item.setVisible(true);
    item.setGravity(0, 0);
    item.setVelocityY(Phaser.Math.Between(this.minFallSpeed, this.maxFallSpeed));
    item.setData('type', itemType);
  }

  private getRandomTextureKey(itemType: ItemType): string {
    const keys =
      itemType === 'good'
        ? this.config.assets.goodItems.map((_, index) => `${GOOD_TEXTURE_PREFIX}${index}`)
        : this.config.assets.badItems.map((_, index) => `${BAD_TEXTURE_PREFIX}${index}`);

    if (keys.length === 0) {
      throw new Error(`Missing asset paths for ${itemType} items in config.assets.${itemType}Items`);
    }

    return keys[Phaser.Math.Between(0, keys.length - 1)];
  }

  private handleItemCaught(
    _player: Phaser.Physics.Arcade.Body | Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
    itemTarget: Phaser.Physics.Arcade.Body | Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
  ): void {
    if (!this.isPlaying || !('getData' in itemTarget)) {
      return;
    }

    const item = itemTarget as Phaser.Physics.Arcade.Image;
    const itemType = item.getData('type') as FallingItemData['type'] | undefined;
    if (!itemType) {
      item.destroy();
      return;
    }

    item.destroy();

    if (itemType === 'good') {
      this.score += this.config.gameplay.scorePerGoodItem;
    } else {
      this.score = Math.max(0, this.score - this.config.gameplay.scorePerBadItem);
    }

    this.emitScore();
    this.game.events.emit('itemCaught', { type: itemType });
  }

  private emitScore(): void {
    this.game.events.emit('scoreUpdated', this.score);
  }

  private emitTimer(): void {
    this.game.events.emit('timerUpdated', this.timeRemaining);
  }

  private getConfig(): GameConfig {
    const rawConfig = this.game.registry.get('config');
    if (!rawConfig) {
      throw new Error('Game config is not available in registry under key "config".');
    }

    const config = rawConfig as Partial<GameConfig>;
    if (
      !config.assets?.player ||
      !Array.isArray(config.assets.goodItems) ||
      !Array.isArray(config.assets.badItems) ||
      typeof config.physics?.itemSpawnRateMs !== 'number' ||
      typeof config.physics.itemFallSpeedMin !== 'number' ||
      typeof config.physics.itemFallSpeedMax !== 'number' ||
      typeof config.gameplay?.durationSeconds !== 'number' ||
      typeof config.gameplay.scorePerGoodItem !== 'number' ||
      typeof config.gameplay.scorePerBadItem !== 'number'
    ) {
      throw new Error('Invalid config shape. Verify assets, physics, and gameplay values in public/config.json.');
    }

    return config as GameConfig;
  }
}
