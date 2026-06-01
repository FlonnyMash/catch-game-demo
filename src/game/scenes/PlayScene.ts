import Phaser from 'phaser';
import { PLAYER_TOUCH_EVENT, type PlayerTouchPayload } from '../../ui/touchControls';

type ItemType = 'good' | 'bad';

interface SpriteFrameConfig {
  frameWidth: number;
  frameHeight: number;
  displayWidth?: number;
}

interface GoodItemConfig extends SpriteFrameConfig {
  image: string;
}

interface BadItemConfig extends GoodItemConfig {
  fallSpeed: number;
  rotateWhileFalling?: boolean;
  /** Degrees per second; random spin direction when omitted uses ±1. */
  fallRotationSpeed?: number;
}

interface PlayerSpriteConfig extends SpriteFrameConfig {
  /** When true, mirror the sprite while moving right; when false, mirror while moving left. */
  flipXWhenMovingRight?: boolean;
  walkAnimation: {
    start: number;
    end: number;
    frameRate: number;
  };
}

interface AssetConfig {
  player: string;
  playerSprite: PlayerSpriteConfig;
  goodItems: GoodItemConfig[];
  badItems: BadItemConfig[];
}

interface PhysicsConfig {
  goodItemSpawnRateMs: number;
  badItemSpawnRateMs: number;
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
const PLAYER_WALK_ANIM_KEY = 'player-walk';
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
  private goodSpawnTimerEvent?: Phaser.Time.TimerEvent;
  private badSpawnTimerEvent?: Phaser.Time.TimerEvent;
  private countdownTimerEvent?: Phaser.Time.TimerEvent;
  private touchActive = false;
  private touchTargetX: number | null = null;
  private readonly onPlayRequested = (): void => {
    this.startRound();
  };
  private readonly onPlayerTouch = (payload: PlayerTouchPayload): void => {
    if (!this.isPlaying) {
      return;
    }

    if (payload.active) {
      this.touchActive = true;
      this.touchTargetX = payload.gameX;
      return;
    }

    this.clearTouchInput();
  };

  constructor() {
    super('PlayScene');
  }

  preload(): void {
    this.config = this.getConfig();
    const { frameWidth, frameHeight } = this.config.assets.playerSprite;
    this.load.spritesheet(PLAYER_TEXTURE_KEY, this.config.assets.player, {
      frameWidth,
      frameHeight,
    });

    this.config.assets.goodItems.forEach((item, index) => {
      this.load.spritesheet(`${GOOD_TEXTURE_PREFIX}${index}`, item.image, {
        frameWidth: item.frameWidth,
        frameHeight: item.frameHeight,
      });
    });

    this.config.assets.badItems.forEach((item, index) => {
      this.load.spritesheet(`${BAD_TEXTURE_PREFIX}${index}`, item.image, {
        frameWidth: item.frameWidth,
        frameHeight: item.frameHeight,
      });
    });
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const worldBounds = this.physics.world.bounds;
    worldBounds.setTo(0, 0, width, height);

    this.createPlayerAnimations();

    this.player = this.physics.add.sprite(width / 2, height - 48, PLAYER_TEXTURE_KEY);
    this.player.setCollideWorldBounds(true);
    this.player.setImmovable(true);
    this.player.setGravity(0, 0);
    this.player.setVelocity(0, 0);

    const { frameWidth, frameHeight, displayWidth } = this.config.assets.playerSprite;
    const targetWidth = displayWidth ?? frameWidth;
    const targetHeight = (targetWidth / frameWidth) * frameHeight;
    this.player.setDisplaySize(targetWidth, targetHeight);
    this.player.setFrame(this.config.assets.playerSprite.walkAnimation.start);

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

    this.game.events.on(PLAYER_TOUCH_EVENT, this.onPlayerTouch);
    this.game.events.on('uiPlayRequested', this.onPlayRequested);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(PLAYER_TOUCH_EVENT, this.onPlayerTouch);
      this.game.events.off('uiPlayRequested', this.onPlayRequested);
      this.clearTouchInput();
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

    if (this.touchActive && this.touchTargetX !== null) {
      const halfWidth = this.player.displayWidth / 2;
      const clampedX = Phaser.Math.Clamp(
        this.touchTargetX,
        halfWidth,
        this.scale.width - halfWidth,
      );
      const dx = clampedX - this.player.x;
      this.player.x = clampedX;
      this.player.setVelocityX(0);
      const animVelocity = Math.abs(dx) < 0.5 ? 0 : Math.sign(dx) * speed;
      this.updatePlayerAnimation(animVelocity);
    } else {
      const movingLeft = this.cursors.left?.isDown ?? false;
      const movingRight = this.cursors.right?.isDown ?? false;
      const horizontalVelocity = (Number(movingRight) - Number(movingLeft)) * speed;
      this.player.setVelocityX(horizontalVelocity);
      this.updatePlayerAnimation(horizontalVelocity);
    }

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
    this.updatePlayerAnimation(0);
    this.clearTouchInput();

    this.emitScore();
    this.emitTimer();
    this.game.events.emit('gameStarted');

    this.goodSpawnTimerEvent = this.time.addEvent({
      delay: this.config.physics.goodItemSpawnRateMs,
      loop: true,
      callback: () => this.spawnItem('good'),
      callbackScope: this,
    });

    this.badSpawnTimerEvent = this.time.addEvent({
      delay: this.config.physics.badItemSpawnRateMs,
      loop: true,
      callback: () => this.spawnItem('bad'),
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
    this.updatePlayerAnimation(0);
    this.clearTouchInput();
    this.game.events.emit('gameOver', { score: this.score });
  }

  private clearTouchInput(): void {
    this.touchActive = false;
    this.touchTargetX = null;
  }

  private createPlayerAnimations(): void {
    const { walkAnimation } = this.config.assets.playerSprite;

    if (this.anims.exists(PLAYER_WALK_ANIM_KEY)) {
      return;
    }

    this.anims.create({
      key: PLAYER_WALK_ANIM_KEY,
      frames: this.anims.generateFrameNumbers(PLAYER_TEXTURE_KEY, {
        start: walkAnimation.start,
        end: walkAnimation.end,
      }),
      frameRate: walkAnimation.frameRate,
      repeat: -1,
    });
  }

  private updatePlayerAnimation(horizontalVelocity: number): void {
    const idleFrame = this.config.assets.playerSprite.walkAnimation.start;

    if (horizontalVelocity === 0) {
      this.player.anims.stop();
      this.player.setFrame(idleFrame);
      return;
    }

    const flipWhenMovingRight = this.config.assets.playerSprite.flipXWhenMovingRight ?? true;
    const movingRight = horizontalVelocity > 0;
    this.player.setFlipX(flipWhenMovingRight ? movingRight : !movingRight);

    if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== PLAYER_WALK_ANIM_KEY) {
      this.player.play(PLAYER_WALK_ANIM_KEY);
    }
  }

  private clearRoundTimers(): void {
    this.goodSpawnTimerEvent?.remove();
    this.goodSpawnTimerEvent = undefined;
    this.badSpawnTimerEvent?.remove();
    this.badSpawnTimerEvent = undefined;
    this.countdownTimerEvent?.remove();
    this.countdownTimerEvent = undefined;
  }

  private spawnItem(itemType: ItemType): void {
    if (!this.isPlaying) {
      return;
    }
    const { textureKey, itemConfig } = this.pickRandomItem(itemType);
    const x = Phaser.Math.Between(24, Math.max(24, this.scale.width - 24));
    const y = -16;

    const item = this.itemGroup.create(x, y, textureKey) as Phaser.Physics.Arcade.Image | null;
    if (!item) {
      return;
    }

    item.setActive(true);
    item.setVisible(true);
    item.setFrame(0);
    this.applyItemDisplaySize(item, itemConfig);
    item.setGravity(0, 0);
    item.setVelocityY(this.getFallSpeed(itemType, itemConfig));
    item.setData('type', itemType);

    if (itemType === 'bad') {
      this.applyBadItemFallRotation(item, itemConfig as BadItemConfig);
    }
  }

  private getFallSpeed(itemType: ItemType, itemConfig: GoodItemConfig | BadItemConfig): number {
    if (itemType === 'bad') {
      return (itemConfig as BadItemConfig).fallSpeed;
    }

    return Phaser.Math.Between(this.minFallSpeed, this.maxFallSpeed);
  }

  private applyBadItemFallRotation(item: Phaser.Physics.Arcade.Image, itemConfig: BadItemConfig): void {
    if (!itemConfig.rotateWhileFalling) {
      return;
    }

    const speed = itemConfig.fallRotationSpeed ?? 120;
    const direction = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
    const body = item.body;
    if (body && 'setAllowRotation' in body) {
      body.setAllowRotation(true);
    }
    item.setAngularVelocity(speed * direction);
  }

  private applyItemDisplaySize(item: Phaser.Physics.Arcade.Image, itemConfig: GoodItemConfig): void {
    const targetWidth = itemConfig.displayWidth ?? itemConfig.frameWidth;
    const targetHeight = (targetWidth / itemConfig.frameWidth) * itemConfig.frameHeight;
    item.setDisplaySize(targetWidth, targetHeight);
  }

  private pickRandomItem(itemType: ItemType): { textureKey: string; itemConfig: GoodItemConfig | BadItemConfig } {
    const items = itemType === 'good' ? this.config.assets.goodItems : this.config.assets.badItems;
    const prefix = itemType === 'good' ? GOOD_TEXTURE_PREFIX : BAD_TEXTURE_PREFIX;

    if (items.length === 0) {
      throw new Error(`No ${itemType} items defined in config.assets.${itemType}Items`);
    }

    const index = Phaser.Math.Between(0, items.length - 1);
    return {
      textureKey: `${prefix}${index}`,
      itemConfig: items[index],
    };
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
      typeof config.assets.playerSprite?.frameWidth !== 'number' ||
      typeof config.assets.playerSprite?.frameHeight !== 'number' ||
      typeof config.assets.playerSprite?.walkAnimation?.start !== 'number' ||
      typeof config.assets.playerSprite?.walkAnimation?.end !== 'number' ||
      typeof config.assets.playerSprite?.walkAnimation?.frameRate !== 'number' ||
      !this.isValidGoodItems(config.assets.goodItems) ||
      !this.isValidBadItems(config.assets.badItems) ||
      typeof config.physics?.goodItemSpawnRateMs !== 'number' ||
      typeof config.physics?.badItemSpawnRateMs !== 'number' ||
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

  private isValidGoodItems(items: unknown): items is GoodItemConfig[] {
    return (
      Array.isArray(items) &&
      items.length > 0 &&
      items.every(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as GoodItemConfig).image === 'string' &&
          typeof (item as GoodItemConfig).frameWidth === 'number' &&
          typeof (item as GoodItemConfig).frameHeight === 'number' &&
          ((item as GoodItemConfig).displayWidth === undefined ||
            typeof (item as GoodItemConfig).displayWidth === 'number'),
      )
    );
  }

  private isValidBadItems(items: unknown): items is BadItemConfig[] {
    return (
      this.isValidGoodItems(items) &&
      (items as BadItemConfig[]).every(
        (item) =>
          typeof item.fallSpeed === 'number' &&
          (item.rotateWhileFalling === undefined || typeof item.rotateWhileFalling === 'boolean') &&
          (item.fallRotationSpeed === undefined || typeof item.fallRotationSpeed === 'number'),
      )
    );
  }
}
