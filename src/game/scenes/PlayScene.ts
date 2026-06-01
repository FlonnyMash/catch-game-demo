import Phaser from 'phaser';
import { PLAYER_TOUCH_EVENT, type PlayerTouchPayload } from '../../ui/touchControls';

type ItemType = 'good' | 'bad';

interface SpriteFrameConfig {
  frameWidth: number;
  frameHeight: number;
  displayWidth?: number;
}

/** Collision box as fractions of the item's display size (0–1). Offsets are from the top-left. */
interface ItemHitboxConfig {
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
}

interface GoodItemConfig extends SpriteFrameConfig {
  image: string;
  hitbox?: ItemHitboxConfig;
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

interface GroundConfig {
  image: string;
  height: number;
}

interface AssetConfig {
  ground: GroundConfig;
  player: string;
  playerSprite: PlayerSpriteConfig;
  goodItems: GoodItemConfig[];
  badItems: BadItemConfig[];
}

interface PhysicsConfig {
  debug?: boolean;
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
const GROUND_TEXTURE_KEY = 'ground';
const GOOD_TEXTURE_PREFIX = 'item-good-';
const BAD_TEXTURE_PREFIX = 'item-bad-';

export class PlayScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private groundCollider!: Phaser.Physics.Arcade.Sprite;
  private groundTopY = 0;
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
  private isDebugFrozen = false;
  private readonly onPlayRequested = (): void => {
    this.startRound();
  };
  private readonly onDebugFreezeToggled = (): void => {
    if (!this.isPhysicsDebugEnabled() || !this.isPlaying) {
      return;
    }

    this.setDebugFrozen(!this.isDebugFrozen);
  };
  private readonly onPlayerTouch = (payload: PlayerTouchPayload): void => {
    if (!this.isPlaying || this.isDebugFrozen) {
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

    this.load.image(GROUND_TEXTURE_KEY, this.config.assets.ground.image);
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const worldBounds = this.physics.world.bounds;
    worldBounds.setTo(0, 0, width, height);

    this.createPlayerAnimations();
    this.createGround(width, height);

    const { frameWidth, frameHeight, displayWidth } = this.config.assets.playerSprite;
    const targetWidth = displayWidth ?? frameWidth;
    const targetHeight = (targetWidth / frameWidth) * frameHeight;

    this.player = this.physics.add.sprite(
      width / 2,
      this.groundTopY - targetHeight / 2,
      PLAYER_TEXTURE_KEY,
    );
    this.player.setCollideWorldBounds(true);
    this.player.setImmovable(true);
    this.player.setGravity(0, 0);
    this.player.setVelocity(0, 0);

    this.player.setDisplaySize(targetWidth, targetHeight);
    this.player.setDepth(1);
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

    this.physics.add.overlap(
      this.itemGroup,
      this.groundCollider,
      this.handleItemHitGround as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );

    this.game.events.on(PLAYER_TOUCH_EVENT, this.onPlayerTouch);
    this.game.events.on('uiPlayRequested', this.onPlayRequested);
    this.game.events.on('debugFreezeToggled', this.onDebugFreezeToggled);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(PLAYER_TOUCH_EVENT, this.onPlayerTouch);
      this.game.events.off('uiPlayRequested', this.onPlayRequested);
      this.game.events.off('debugFreezeToggled', this.onDebugFreezeToggled);
      this.releaseDebugFreeze();
      this.clearTouchInput();
      this.clearRoundTimers();
    });

    this.emitScore();
    this.emitTimer();
  }

  update(): void {
    if (!this.isPlaying || this.isDebugFrozen || !this.player?.active) {
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

    this.itemGroup.getChildren().forEach((child) => {
      const item = child as Phaser.Physics.Arcade.Image;
      if (item.active && this.getItemBottomY(item) >= this.groundTopY) {
        item.destroy();
      }
    });
  }

  private startRound(): void {
    if (this.isPlaying) {
      return;
    }

    this.isPlaying = true;
    this.releaseDebugFreeze();
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
    this.releaseDebugFreeze();
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

  private isPhysicsDebugEnabled(): boolean {
    return this.config.physics.debug === true;
  }

  private setDebugFrozen(frozen: boolean): void {
    if (this.isDebugFrozen === frozen) {
      return;
    }

    this.isDebugFrozen = frozen;

    if (frozen) {
      this.physics.world.pause();
      this.time.timeScale = 0;
      this.anims.pauseAll();
      this.player.setVelocity(0, 0);
      this.clearTouchInput();
    } else {
      this.physics.world.resume();
      this.time.timeScale = 1;
      this.anims.resumeAll();
    }

    this.game.events.emit('debugFreezeChanged', { frozen });
  }

  private releaseDebugFreeze(): void {
    if (!this.isDebugFrozen) {
      if (this.time.timeScale === 0) {
        this.time.timeScale = 1;
      }
      if (this.physics.world.isPaused) {
        this.physics.world.resume();
      }
      return;
    }

    this.isDebugFrozen = false;
    this.physics.world.resume();
    this.time.timeScale = 1;
    this.anims.resumeAll();
    this.game.events.emit('debugFreezeChanged', { frozen: false });
  }

  private createGround(width: number, height: number): void {
    const groundHeight = this.config.assets.ground.height;
    this.groundTopY = height - groundHeight;
    const groundCenterY = this.groundTopY + groundHeight / 2;

    this.add.tileSprite(width / 2, groundCenterY, width, groundHeight, GROUND_TEXTURE_KEY);

    this.groundCollider = this.physics.add.staticSprite(width / 2, groundCenterY, GROUND_TEXTURE_KEY);
    this.groundCollider.setDisplaySize(width, groundHeight);
    this.groundCollider.setVisible(false);
    this.groundCollider.refreshBody();
  }

  private handleItemHitGround(
    object1: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
    object2: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
  ): void {
    if (!this.isPlaying) {
      return;
    }

    const item = this.getFallingItemFromOverlap(object1, object2);
    if (item?.active) {
      item.destroy();
    }
  }

  private getFallingItemFromOverlap(
    object1: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
    object2: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
  ): Phaser.Physics.Arcade.Image | null {
    for (const object of [object1, object2]) {
      if (!('getData' in object)) {
        continue;
      }

      const candidate = object as Phaser.Physics.Arcade.Image;
      const itemType = candidate.getData('type') as ItemType | undefined;
      if (itemType === 'good' || itemType === 'bad') {
        return candidate;
      }
    }

    return null;
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
    this.applyItemHitbox(item, itemConfig);
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

  private getItemBottomY(item: Phaser.Physics.Arcade.Image): number {
    const body = item.body;
    if (body) {
      return body.bottom;
    }

    return item.y + item.displayHeight / 2;
  }

  private applyItemDisplaySize(item: Phaser.Physics.Arcade.Image, itemConfig: GoodItemConfig): void {
    const targetWidth = itemConfig.displayWidth ?? itemConfig.frameWidth;
    const targetHeight = (targetWidth / itemConfig.frameWidth) * itemConfig.frameHeight;
    item.setDisplaySize(targetWidth, targetHeight);
  }

  private applyItemHitbox(item: Phaser.Physics.Arcade.Image, itemConfig: GoodItemConfig): void {
    const hitbox = itemConfig.hitbox;
    if (!hitbox) {
      return;
    }

    const body = item.body;
    if (!body) {
      return;
    }

    const widthFrac = hitbox.width ?? 1;
    const heightFrac = hitbox.height ?? 1;
    const hitWidth = item.displayWidth * widthFrac;
    const hitHeight = item.displayHeight * heightFrac;
    const hasCustomOffset = hitbox.offsetX !== undefined || hitbox.offsetY !== undefined;

    if (!hasCustomOffset) {
      body.setSize(hitWidth, hitHeight, true);
      return;
    }

    const offsetX =
      hitbox.offsetX !== undefined ? hitbox.offsetX * item.displayWidth : (item.displayWidth - hitWidth) / 2;
    const offsetY =
      hitbox.offsetY !== undefined ? hitbox.offsetY * item.displayHeight : (item.displayHeight - hitHeight) / 2;

    body.setSize(hitWidth, hitHeight);
    body.setOffset(offsetX / item.scaleX, offsetY / item.scaleY);
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
      typeof config.assets?.ground?.image !== 'string' ||
      typeof config.assets.ground.height !== 'number' ||
      config.assets.ground.height <= 0 ||
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
            typeof (item as GoodItemConfig).displayWidth === 'number') &&
          this.isValidItemHitbox((item as GoodItemConfig).hitbox),
      )
    );
  }

  private isValidItemHitbox(hitbox: unknown): boolean {
    if (hitbox === undefined) {
      return true;
    }

    if (typeof hitbox !== 'object' || hitbox === null) {
      return false;
    }

    const isSizeFraction = (value: unknown): boolean =>
      value === undefined || (typeof value === 'number' && value > 0 && value <= 1);
    const isOffsetFraction = (value: unknown): boolean =>
      value === undefined || (typeof value === 'number' && value >= 0 && value <= 1);

    const h = hitbox as ItemHitboxConfig;
    return (
      isSizeFraction(h.width) &&
      isSizeFraction(h.height) &&
      isOffsetFraction(h.offsetX) &&
      isOffsetFraction(h.offsetY)
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
