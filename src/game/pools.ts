import type Phaser from "phaser";

export type PoolableSprite = Phaser.Physics.Arcade.Sprite;

export class SpritePool {
  private readonly free: PoolableSprite[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly textureKey: string,
    private readonly size: number,
    private readonly onCreate?: (s: PoolableSprite) => void,
  ) {
    for (let i = 0; i < size; i++) {
      const s = scene.physics.add.sprite(0, 0, textureKey);
      s.setActive(false).setVisible(false);
      if (s.body) (s.body as Phaser.Physics.Arcade.Body).enable = false;
      onCreate?.(s);
      this.free.push(s);
    }
  }

  get(x: number, y: number): PoolableSprite | null {
    const s = this.free.pop();
    if (!s) return null;
    s.setPosition(x, y);
    s.setActive(true).setVisible(true);
    if (s.body) {
      const b = s.body as Phaser.Physics.Arcade.Body;
      b.enable = true;
      b.reset(x, y);
    }
    return s;
  }

  release(s: PoolableSprite): void {
    s.setVelocity(0, 0);
    s.setActive(false).setVisible(false);
    if (s.body) (s.body as Phaser.Physics.Arcade.Body).enable = false;
    this.free.push(s);
  }

  get freeCount(): number {
    return this.free.length;
  }
}
