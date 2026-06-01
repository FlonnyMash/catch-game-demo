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

interface GameConfig {
  assets: AssetConfig;
  physics: PhysicsConfig;
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

    this.time.addEvent({
      delay: this.config.physics.itemSpawnRateMs,
      loop: true,
      callback: this.spawnItem,
      callbackScope: this,
    });

    this.physics.add.overlap(this.player, this.itemGroup, this.handleItemCaught as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback, undefined, this);
  }

  update(): void {
    if (!this.player || !this.player.active) {
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

  private spawnItem(): void {
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
    if (!('getData' in itemTarget)) {
      return;
    }

    const item = itemTarget as Phaser.Physics.Arcade.Image;
    const itemType = item.getData('type') as FallingItemData['type'] | undefined;
    if (!itemType) {
      item.destroy();
      return;
    }

    item.destroy();
    this.game.events.emit('itemCaught', { type: itemType });
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
      typeof config.physics.itemFallSpeedMax !== 'number'
    ) {
      throw new Error('Invalid config shape. Verify assets and physics values in public/config.json.');
    }

    return config as GameConfig;
  }
}
