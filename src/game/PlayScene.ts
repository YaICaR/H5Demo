import Phaser from "phaser";
import { SpritePool } from "./pools";
import {
  getAudioSettings,
  subscribeAudioSettings,
  type AudioSettings,
} from "../audioSettings";

/** 世界最小尺寸；实际边长会按视口放大，避免出现「画面比地图宽」时两侧大块无网格空白 */
const MIN_WORLD_W = 1600;
const MIN_WORLD_H = 1200;
const PLAYER_SPEED = 220;
const BULLET_SPEED = 520;
const FIRE_MS = 220;
const ENEMY_SPEED_MIN = 70;
const ENEMY_SPEED_MAX = 130;
const DEMO_MS = 2 * 60 * 1000;
const SPAWN_START_MS = 450;
const SPAWN_MIN_MS = 120;
const CONTACT_DAMAGE = 18;
const INVULN_MS = 500;
const PLAYER_MAX_HP = 100;

const SCORE_SMALL = 1;
const SCORE_LARGE = 2;
const LARGE_SPAWN_CHANCE = 0.28;
const DROP_CHANCE = 0.38;
const BUFF_MS = 10_000;

/** 充能：小敌 +2%，大敌 +5% */
const ULT_CHARGE_SMALL = 2;
const ULT_CHARGE_LARGE = 5;
/** 冲击波半径（世界坐标） */
const WAVE_RADIUS = 240;

/** 小敌碰撞半径（与 setCircle 一致） */
const R_SMALL = 10;
/** 大敌比小敌大 100%：线尺寸为小敌 2 倍（半径加倍） */
const R_LARGE = R_SMALL * 2;
const BULLET_R = 4;

const HIT_DIST_SMALL = R_SMALL + BULLET_R + 1;
const HIT_DIST_LARGE = R_LARGE + BULLET_R + 1;
const CONTACT_DIST_SMALL = R_SMALL + 12;
const CONTACT_DIST_LARGE = R_LARGE + 12;
const PICKUP_DIST = 18;

function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export class PlayScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private enemyPool!: SpritePool;
  private enemyLargePool!: SpritePool;
  private bulletPool!: SpritePool;
  private pickupPool!: SpritePool;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  private fireTimer = 0;
  private spawnTimer = 0;
  private spawnEvery = SPAWN_START_MS;
  private elapsed = 0;
  private score = 0;
  private hp = PLAYER_MAX_HP;
  private invulnUntil = 0;
  private buffUntil = 0;
  private ended = false;
  /** 0–100，满格可按空格释放冲击波 */
  private ultEnergy = 0;
  private worldW = MIN_WORLD_W;
  private worldH = MIN_WORLD_H;

  private hudTime!: HTMLElement;
  private hudScore!: HTMLElement;
  private hudHp!: HTMLElement;
  private hudBuff!: HTMLElement;
  private ultBarFill!: HTMLElement;
  private ultBarWrap!: HTMLElement;
  private ultBarHint!: HTMLElement;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private overlay!: HTMLElement;
  private overlayTitle!: HTMLElement;
  private overlayDesc!: HTMLElement;
  private readonly sfxCooldownUntil: Record<string, number> = {};
  private bgmSound?: Phaser.Sound.BaseSound;
  private unsubscribeAudio?: () => void;

  constructor() {
    super({ key: "PlayScene" });
  }

  preload(): void {
    // 按当前资源实际命名直接加载，避免多后缀回退带来的 404 干扰
    this.load.audio("Getpoint", "/assets/audio/sfx/Getpoint.mp3");
    this.load.audio("GetBuff", "/assets/audio/sfx/GetBuff.mp3");
    this.load.audio("WavePrepare", "/assets/audio/sfx/WavePrepare.mp3");
    this.load.audio("UseWave", "/assets/audio/sfx/UseWave.mp3");
    this.load.audio("Bgm", "/assets/audio/bgm/Bgm.mp3");
  }

  create(): void {
    this.hudTime = document.getElementById("hud-time")!;
    this.hudScore = document.getElementById("hud-score")!;
    this.hudHp = document.getElementById("hud-hp")!;
    this.hudBuff = document.getElementById("hud-buff")!;
    this.ultBarFill = document.getElementById("ult-bar-fill")!;
    this.ultBarWrap = document.getElementById("ult-bar-wrap")!;
    this.ultBarHint = document.getElementById("ult-bar-hint")!;
    this.overlay = document.getElementById("overlay")!;
    this.overlayTitle = document.getElementById("overlay-title")!;
    this.overlayDesc = document.getElementById("overlay-desc")!;

    this.applyWorldSizeFromViewport();
    this.makeTextures();
    this.drawMap();

    this.physics.world.setBounds(0, 0, this.worldW, this.worldH);

    this.player = this.physics.add.sprite(this.worldW / 2, this.worldH / 2, "player");
    this.player.setCollideWorldBounds(true);

    this.enemyPool = new SpritePool(this, "enemy", 80, (s) => {
      s.setCircle(R_SMALL);
    });
    this.enemyLargePool = new SpritePool(this, "enemy_large", 36, (s) => {
      s.setCircle(R_LARGE);
    });
    this.bulletPool = new SpritePool(this, "bullet", 60, (s) => {
      s.setCircle(BULLET_R);
    });
    this.pickupPool = new SpritePool(this, "pickup_buff", 24, (s) => {
      s.setCircle(6);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.spaceKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );

    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.overlay.classList.remove("visible");
    this.ended = false;
    this.elapsed = 0;
    this.score = 0;
    this.hp = PLAYER_MAX_HP;
    this.fireTimer = 0;
    this.spawnTimer = 0;
    this.spawnEvery = SPAWN_START_MS;
    this.invulnUntil = 0;
    this.buffUntil = 0;
    this.ultEnergy = 0;
    this.physics.resume();
    this.player.setAlpha(1);

    this.updateHud();
    this.updateBuffHud();
    this.updateUltBar();
    this.playBgmLoop();
    this.applyAudioSettings(getAudioSettings());
    this.unsubscribeAudio = subscribeAudioSettings((s) => {
      this.applyAudioSettings(s);
    });
    this.events.once("shutdown", () => {
      this.unsubscribeAudio?.();
      this.unsubscribeAudio = undefined;
    });
  }

  /**
   * 世界坐标与屏幕像素默认 1:1，故世界宽高须 ≥ 视口，否则相机四周会出现「纯色无战场」区域。
   */
  private applyWorldSizeFromViewport(): void {
    const vw = Math.ceil(this.scale.width);
    const vh = Math.ceil(this.scale.height);
    const margin = 480;
    this.worldW = Math.max(MIN_WORLD_W, vw + margin);
    this.worldH = Math.max(MIN_WORLD_H, vh + margin);
  }

  private makeTextures(): void {
    const g = this.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0x58a6ff, 1);
    g.fillCircle(12, 12, 12);
    g.generateTexture("player", 24, 24);
    g.clear();

    g.fillStyle(0xf85149, 1);
    g.fillCircle(10, 10, 10);
    g.generateTexture("enemy", 20, 20);
    g.clear();

    g.fillStyle(0xff8c00, 1);
    g.fillCircle(R_LARGE, R_LARGE, R_LARGE);
    g.generateTexture("enemy_large", R_LARGE * 2, R_LARGE * 2);
    g.clear();

    g.fillStyle(0xffd93d, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture("bullet", 8, 8);
    g.clear();

    g.fillStyle(0x3fb950, 1);
    g.fillCircle(6, 6, 6);
    g.generateTexture("pickup_buff", 12, 12);
    g.destroy();
  }

  private playSfx(name: string, volume = 0.45, cooldownMs = 0): void {
    if (!this.cache.audio.exists(name)) return;
    const settings = getAudioSettings();
    if (settings.muted) return;
    const now = this.time.now;
    const blockedUntil = this.sfxCooldownUntil[name] ?? 0;
    if (now < blockedUntil) return;
    if (cooldownMs > 0) {
      this.sfxCooldownUntil[name] = now + cooldownMs;
    }
    this.sound.play(name, { volume: volume * settings.sfxVolume });
  }

  private playBgmLoop(): void {
    if (!this.cache.audio.exists("Bgm")) return;
    const existing = this.sound.get("Bgm");
    if (existing?.isPlaying) return;
    this.bgmSound = this.sound.add("Bgm", {
      loop: true,
    });
    this.bgmSound.play();
    this.applyAudioSettings(getAudioSettings());
  }

  private applyAudioSettings(settings: AudioSettings): void {
    this.sound.mute = settings.muted;
    if (this.bgmSound) {
      (this.bgmSound as Phaser.Sound.WebAudioSound).setVolume(settings.bgmVolume);
    }
  }

  private drawMap(): void {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x161b22, 0x161b22, 0x0d1117, 0x0d1117, 1);
    bg.fillRect(0, 0, this.worldW, this.worldH);

    const grid = this.add.graphics();
    grid.lineStyle(1, 0x30363d, 0.35);
    const step = 80;
    for (let x = 0; x <= this.worldW; x += step) {
      grid.lineBetween(x, 0, x, this.worldH);
    }
    for (let y = 0; y <= this.worldH; y += step) {
      grid.lineBetween(0, y, this.worldW, y);
    }
  }

  private getActiveEnemies(): Phaser.Physics.Arcade.Sprite[] {
    const out: Phaser.Physics.Arcade.Sprite[] = [];
    const children = this.children.list;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (
        c instanceof Phaser.Physics.Arcade.Sprite &&
        c.active &&
        (c.texture?.key === "enemy" || c.texture?.key === "enemy_large")
      ) {
        out.push(c);
      }
    }
    return out;
  }

  private getActiveBullets(): Phaser.Physics.Arcade.Sprite[] {
    const out: Phaser.Physics.Arcade.Sprite[] = [];
    const children = this.children.list;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (
        c instanceof Phaser.Physics.Arcade.Sprite &&
        c.active &&
        c.texture?.key === "bullet"
      ) {
        out.push(c);
      }
    }
    return out;
  }

  private getActivePickups(): Phaser.Physics.Arcade.Sprite[] {
    const out: Phaser.Physics.Arcade.Sprite[] = [];
    const children = this.children.list;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (
        c instanceof Phaser.Physics.Arcade.Sprite &&
        c.active &&
        c.texture?.key === "pickup_buff"
      ) {
        out.push(c);
      }
    }
    return out;
  }

  private getFireInterval(): number {
    return this.time.now < this.buffUntil ? FIRE_MS * 0.5 : FIRE_MS;
  }

  private releaseEnemy(e: Phaser.Physics.Arcade.Sprite): void {
    if (e.texture.key === "enemy_large") {
      this.enemyLargePool.release(e);
    } else {
      this.enemyPool.release(e);
    }
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;

    this.elapsed += delta;
    const left = DEMO_MS - this.elapsed;
    if (left <= 0) {
      this.endDemo("时间到", `得分 ${this.score}`);
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.tryTriggerWave();
    }

    this.movePlayer();
    this.fireTimer += delta;
    if (this.fireTimer >= this.getFireInterval()) {
      this.fireTimer = 0;
      this.tryFire();
    }

    this.spawnTimer += delta;
    this.spawnEvery = Math.max(
      SPAWN_MIN_MS,
      SPAWN_START_MS - Math.floor(this.elapsed / 8000) * 35,
    );
    if (this.spawnTimer >= this.spawnEvery) {
      this.spawnTimer = 0;
      this.spawnEnemy();
    }

    this.updateEnemies();
    this.checkBulletEnemyHits();
    this.checkPlayerEnemyHits();
    this.checkPickupCollection();
    this.updateHudTime(left);
    this.updateBuffHud();
  }

  private movePlayer(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const ptr = this.input.activePointer;

    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) vy += 1;

    if (ptr.isDown) {
      const wx = ptr.worldX;
      const wy = ptr.worldY;
      const dx = wx - this.player.x;
      const dy = wy - this.player.y;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        vx = dx / len;
        vy = dy / len;
      }
    } else if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx /= len;
      vy /= len;
    }

    if (vx !== 0 || vy !== 0) {
      body.setVelocity(vx * PLAYER_SPEED, vy * PLAYER_SPEED);
    } else {
      body.setVelocity(0, 0);
    }
  }

  private nearestEnemy(
    x: number,
    y: number,
    maxDist: number,
  ): Phaser.Physics.Arcade.Sprite | null {
    const enemies = this.getActiveEnemies();
    let best: Phaser.Physics.Arcade.Sprite | null = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    return best;
  }

  private tryFire(): void {
    const range = 420;
    const target = this.nearestEnemy(this.player.x, this.player.y, range);
    if (!target) return;

    const b = this.bulletPool.get(this.player.x, this.player.y);
    if (!b) return;

    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setVelocity((dx / len) * BULLET_SPEED, (dy / len) * BULLET_SPEED);
  }

  private spawnEnemy(): void {
    const edge = Phaser.Math.Between(0, 3);
    let x = 0;
    let y = 0;
    if (edge === 0) {
      x = Phaser.Math.Between(0, this.worldW);
      y = -20;
    } else if (edge === 1) {
      x = this.worldW + 20;
      y = Phaser.Math.Between(0, this.worldH);
    } else if (edge === 2) {
      x = Phaser.Math.Between(0, this.worldW);
      y = this.worldH + 20;
    } else {
      x = -20;
      y = Phaser.Math.Between(0, this.worldH);
    }

    const large = Phaser.Math.FloatBetween(0, 1) < LARGE_SPAWN_CHANCE;
    const e = large
      ? this.enemyLargePool.get(x, y)
      : this.enemyPool.get(x, y);
    if (!e) return;

    const t = Phaser.Math.FloatBetween(ENEMY_SPEED_MIN, ENEMY_SPEED_MAX);
    e.setData("chaseSpeed", t);
    e.setData("hp", large ? 2 : 1);
    const ang = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    const body = e.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(ang) * t, Math.sin(ang) * t);
  }

  private spawnPickup(x: number, y: number): void {
    const p = this.pickupPool.get(x, y);
    if (!p) return;
    const body = p.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
  }

  private updateEnemies(): void {
    const enemies = this.getActiveEnemies();
    const px = this.player.x;
    const py = this.player.y;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const ang = Phaser.Math.Angle.Between(e.x, e.y, px, py);
      const body = e.body as Phaser.Physics.Arcade.Body;
      const speed =
        (e.getData("chaseSpeed") as number | undefined) ?? ENEMY_SPEED_MIN;
      body.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
    }
  }

  private hitDistSqForEnemy(e: Phaser.Physics.Arcade.Sprite): number {
    const d =
      e.texture.key === "enemy_large" ? HIT_DIST_LARGE : HIT_DIST_SMALL;
    return d * d;
  }

  private contactDistSqForEnemy(e: Phaser.Physics.Arcade.Sprite): number {
    const d =
      e.texture.key === "enemy_large"
        ? CONTACT_DIST_LARGE
        : CONTACT_DIST_SMALL;
    return d * d;
  }

  private checkBulletEnemyHits(): void {
    const bullets = this.getActiveBullets();
    const enemies = this.getActiveEnemies();

    for (let bi = 0; bi < bullets.length; bi++) {
      const b = bullets[bi];
      let consumed = false;
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei];
        if (!e.active) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (dx * dx + dy * dy >= this.hitDistSqForEnemy(e)) continue;

        const hp = (e.getData("hp") as number) ?? 1;
        const newHp = hp - 1;
        this.bulletPool.release(b);
        consumed = true;

        if (newHp <= 0) {
          this.onEnemyKilled(e, { grantCharge: true });
        } else {
          e.setData("hp", newHp);
        }
        break;
      }
      if (consumed) continue;
      if (
        b.x < -40 ||
        b.x > this.worldW + 40 ||
        b.y < -40 ||
        b.y > this.worldH + 40
      ) {
        this.bulletPool.release(b);
      }
    }
  }

  private onEnemyKilled(
    e: Phaser.Physics.Arcade.Sprite,
    opts?: { grantCharge?: boolean },
  ): void {
    const grantCharge = opts?.grantCharge !== false;
    const isLarge = e.texture.key === "enemy_large";
    this.playKillEffect(e.x, e.y, isLarge);
    if (isLarge) {
      this.cameras.main.shake(110, 0.0032, true);
    }
    this.score += isLarge ? SCORE_LARGE : SCORE_SMALL;
    this.hudScore.textContent = `得分 ${this.score}`;
    this.playSfx("Getpoint", 0.42, 40);

    if (grantCharge) {
      this.addUltCharge(isLarge ? ULT_CHARGE_LARGE : ULT_CHARGE_SMALL);
    }

    if (isLarge && Phaser.Math.FloatBetween(0, 1) < DROP_CHANCE) {
      this.spawnPickup(e.x, e.y);
    }

    this.releaseEnemy(e);
  }

  private playKillEffect(x: number, y: number, isLarge: boolean): void {
    const color = isLarge ? 0xff8c00 : 0xf85149;
    const ringMaxRadius = isLarge ? 54 : 34;
    const ringStartRadius = isLarge ? 9 : 6;
    const sparkCount = isLarge ? 11 : 7;
    const sparkDist = isLarge ? 46 : 30;

    // 主扩散环：从小半径开始向外放大并淡出
    const ring = this.add.circle(x, y, ringStartRadius);
    ring.setStrokeStyle(isLarge ? 5 : 4, color, 0.98);
    ring.setFillStyle(color, 0.1);
    this.tweens.add({
      targets: ring,
      radius: ringMaxRadius,
      alpha: 0,
      duration: isLarge ? 480 : 360,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // 次扩散环：稍后出现，增强层次感和可见度
    const ring2 = this.add.circle(x, y, ringStartRadius * 0.8);
    ring2.setStrokeStyle(isLarge ? 3 : 2.5, 0xfff1c1, 0.9);
    this.tweens.add({
      targets: ring2,
      radius: ringMaxRadius * 0.85,
      alpha: 0,
      duration: isLarge ? 540 : 420,
      delay: 45,
      ease: "Sine.easeOut",
      onComplete: () => ring2.destroy(),
    });

    // 粒子：从中心附近向外散射，随后淡出消失
    for (let i = 0; i < sparkCount; i++) {
      const a =
        (Math.PI * 2 * i) / sparkCount + Phaser.Math.FloatBetween(-0.28, 0.28);
      const dot = this.add.circle(
        x + Phaser.Math.FloatBetween(-2, 2),
        y + Phaser.Math.FloatBetween(-2, 2),
        isLarge ? 3.1 : 2.5,
        color,
        1,
      );
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(a) * Phaser.Math.FloatBetween(sparkDist * 0.55, sparkDist),
        y: y + Math.sin(a) * Phaser.Math.FloatBetween(sparkDist * 0.55, sparkDist),
        alpha: 0,
        scale: 0.45,
        duration: isLarge ? 420 : 320,
        ease: "Cubic.easeOut",
        onComplete: () => dot.destroy(),
      });
    }
  }

  private addUltCharge(amount: number): void {
    if (amount <= 0) return;
    const before = this.ultEnergy;
    this.ultEnergy = Math.min(100, this.ultEnergy + amount);
    if (before < 100 && this.ultEnergy >= 100) {
      this.playSfx("WavePrepare", 0.46, 120);
    }
    this.updateUltBar();
  }

  private updateUltBar(): void {
    this.ultBarFill.style.height = `${this.ultEnergy}%`;
    const ready = this.ultEnergy >= 100;
    this.ultBarWrap.classList.toggle("ready", ready);
    this.ultBarHint.classList.toggle("visible", ready);
  }

  private tryTriggerWave(): void {
    if (this.ended || this.ultEnergy < 100) return;
    this.ultEnergy = 0;
    this.updateUltBar();
    this.playSfx("UseWave", 0.5, 60);

    const px = this.player.x;
    const py = this.player.y;
    const r2 = WAVE_RADIUS * WAVE_RADIUS;
    const enemies = [...this.getActiveEnemies()];

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active) continue;
      const dx = e.x - px;
      const dy = e.y - py;
      if (dx * dx + dy * dy <= r2) {
        this.onEnemyKilled(e, { grantCharge: false });
      }
    }

    this.playWaveEffect(px, py);
  }

  private playWaveEffect(x: number, y: number): void {
    const flash = this.add.graphics();
    flash.fillStyle(0x58a6ff, 0.12);
    flash.fillCircle(x, y, WAVE_RADIUS);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 320,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy(),
    });

    const ring = this.add.graphics();
    ring.lineStyle(5, 0x79c0ff, 0.85);
    ring.strokeCircle(x, y, WAVE_RADIUS);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      duration: 420,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private checkPlayerEnemyHits(): void {
    const now = this.time.now;
    if (now < this.invulnUntil) return;

    const enemies = this.getActiveEnemies();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      if (dx * dx + dy * dy < this.contactDistSqForEnemy(e)) {
        this.hp -= CONTACT_DAMAGE;
        this.invulnUntil = now + INVULN_MS;
        this.player.setAlpha(0.45);
        this.time.delayedCall(INVULN_MS, () => {
          if (this.player?.active) this.player.setAlpha(1);
        });
        this.hudHp.textContent = `生命 ${Math.max(0, this.hp)}/${PLAYER_MAX_HP}`;
        if (this.hp <= 0) {
          this.endDemo(
            "失败",
            `坚持 ${formatTime(this.elapsed)} · 得分 ${this.score}`,
          );
        }
        break;
      }
    }
  }

  private checkPickupCollection(): void {
    const pick = this.getActivePickups();
    const px = this.player.x;
    const py = this.player.y;
    const r2 = PICKUP_DIST * PICKUP_DIST;
    for (let i = 0; i < pick.length; i++) {
      const p = pick[i];
      const dx = p.x - px;
      const dy = p.y - py;
      if (dx * dx + dy * dy < r2) {
        this.pickupPool.release(p);
        this.buffUntil = this.time.now + BUFF_MS;
        this.playSfx("GetBuff", 0.45, 40);
      }
    }
  }

  private updateHudTime(left: number): void {
    this.hudTime.textContent = `剩余 ${formatTime(left)}`;
  }

  private updateBuffHud(): void {
    if (this.time.now >= this.buffUntil) {
      this.hudBuff.textContent = "";
      return;
    }
    const sec = Math.max(1, Math.ceil((this.buffUntil - this.time.now) / 1000));
    this.hudBuff.textContent = `攻速×2 · ${sec}s`;
  }

  private updateHud(): void {
    this.hudScore.textContent = `得分 ${this.score}`;
    this.hudTime.textContent = `剩余 ${formatTime(DEMO_MS)}`;
    this.hudHp.textContent = `生命 ${this.hp}/${PLAYER_MAX_HP}`;
  }

  private endDemo(title: string, desc: string): void {
    if (this.ended) return;
    this.ended = true;
    this.physics.pause();
    this.overlayTitle.textContent = title;
    this.overlayDesc.textContent = desc;
    this.overlay.classList.add("visible");
  }

  public endGameNow(): void {
    this.endDemo("试玩结束", `最终得分 ${this.score}`);
  }
}
