import Phaser from "phaser";
import { PlayScene } from "./game/PlayScene";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from "./audioSettings";

const parentEl = document.getElementById("app");
if (!parentEl) throw new Error("#app missing");
const parent: HTMLElement = parentEl;
const startScreen = document.getElementById("start-screen");
const startButton = document.getElementById("btn-start");
const CLICK_BTN_URL = "/assets/audio/sfx/ClickBtn.mp3";
const audioPanel = document.getElementById("audio-panel");
const audioPanelToggle = document.getElementById("btn-audio-panel");
const audioMuted = document.getElementById("audio-muted") as HTMLInputElement | null;
const audioBgm = document.getElementById("audio-bgm") as HTMLInputElement | null;
const audioSfx = document.getElementById("audio-sfx") as HTMLInputElement | null;
const audioBgmValue = document.getElementById("audio-bgm-value");
const audioSfxValue = document.getElementById("audio-sfx-value");
const endGameBtn = document.getElementById("btn-end-game");

function getSize(): { w: number; h: number } {
  const r = parent.getBoundingClientRect();
  const rw = Math.floor(r.width);
  const rh = Math.floor(r.height);
  const w = rw > 0 ? rw : window.innerWidth;
  const h = rh > 0 ? rh : window.innerHeight;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function playClickBtnSfx(): void {
  const settings = getAudioSettings();
  if (settings.muted) return;
  const a = new Audio(CLICK_BTN_URL);
  a.volume = 0.45 * settings.sfxVolume;
  void a.play().catch(() => {});
}

function syncAudioUi(): void {
  const s = getAudioSettings();
  if (audioMuted) audioMuted.checked = s.muted;
  if (audioBgm) audioBgm.value = String(Math.round(s.bgmVolume * 100));
  if (audioSfx) audioSfx.value = String(Math.round(s.sfxVolume * 100));
  if (audioBgmValue) audioBgmValue.textContent = `${Math.round(s.bgmVolume * 100)}%`;
  if (audioSfxValue) audioSfxValue.textContent = `${Math.round(s.sfxVolume * 100)}%`;
}

audioPanelToggle?.addEventListener("click", () => {
  playClickBtnSfx();
  audioPanel?.classList.toggle("visible");
});

audioMuted?.addEventListener("change", () => {
  setAudioSettings({ muted: audioMuted.checked });
});

audioBgm?.addEventListener("input", () => {
  const v = Number(audioBgm.value) / 100;
  setAudioSettings({ bgmVolume: v });
});

audioSfx?.addEventListener("input", () => {
  const v = Number(audioSfx.value) / 100;
  setAudioSettings({ sfxVolume: v });
});

subscribeAudioSettings(() => {
  syncAudioUi();
});

endGameBtn?.addEventListener("click", () => {
  playClickBtnSfx();
  if (!game) return;
  const scene = game.scene.getScene("PlayScene") as PlayScene;
  scene.endGameNow();
  audioPanel?.classList.remove("visible");
});

let game: Phaser.Game | null = null;

function bootGame(): void {
  if (game) return;
  const s = getSize();
  game = new Phaser.Game({
    type: Phaser.AUTO,
    width: s.w,
    height: s.h,
    parent,
    backgroundColor: "#0d1117",
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      expandParent: true,
    },
    scene: [PlayScene],
  });

  const syncScale = (): void => {
    if (!game) return;
    const sz = getSize();
    game.scale.resize(sz.w, sz.h);
    game.scale.refresh();
  };

  requestAnimationFrame(() => {
    syncScale();
    requestAnimationFrame(() => syncScale());
  });

  const ro = new ResizeObserver(() => {
    syncScale();
  });
  ro.observe(parent);
}

startButton?.addEventListener("click", () => {
  playClickBtnSfx();
  startScreen?.classList.add("hidden");
  bootGame();
});

document.getElementById("btn-restart")?.addEventListener("click", () => {
  playClickBtnSfx();
  game?.scene.getScene("PlayScene").scene.restart();
});

window.addEventListener("resize", () => {
  if (!game) return;
  const s = getSize();
  game.scale.resize(s.w, s.h);
});
