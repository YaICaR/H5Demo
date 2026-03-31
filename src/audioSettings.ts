export type AudioSettings = {
  muted: boolean;
  bgmVolume: number;
  sfxVolume: number;
};

const STORAGE_KEY = "h5-game-audio-settings";

const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  bgmVolume: 0.2,
  sfxVolume: 0.45,
};

type Listener = (s: AudioSettings) => void;
const listeners = new Set<Listener>();

let current: AudioSettings = load();

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: Boolean(parsed.muted),
      bgmVolume: clamp01(parsed.bgmVolume ?? DEFAULT_SETTINGS.bgmVolume),
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore write errors
  }
}

function notify(): void {
  for (const fn of listeners) fn({ ...current });
}

export function getAudioSettings(): AudioSettings {
  return { ...current };
}

export function setAudioSettings(next: Partial<AudioSettings>): AudioSettings {
  current = {
    muted: next.muted ?? current.muted,
    bgmVolume: clamp01(next.bgmVolume ?? current.bgmVolume),
    sfxVolume: clamp01(next.sfxVolume ?? current.sfxVolume),
  };
  persist();
  notify();
  return { ...current };
}

export function subscribeAudioSettings(fn: Listener): () => void {
  listeners.add(fn);
  fn({ ...current });
  return () => {
    listeners.delete(fn);
  };
}
