/**
 * BGM manager. Packs are discovered by the settings panel; the release only
 * ships the current 《成熟作品的借用》 playlist, while the source tree also
 * contains the old piano playlist for local listening.
 */
export const MUSIC_PACKS = {
  new: {
    id: 'new',
    name: '《成熟作品的借用》',
    short: '当前专辑',
    tracks: {
      menu: '/audio/playlists/long-night-dam/bgm2-menu.mp3',
      room: '/audio/playlists/long-night-dam/bgm2-room.mp3',
      replay: '/audio/playlists/long-night-dam/bgm2-replay.mp3',
      settings: '/audio/playlists/long-night-dam/bgm2-settings.mp3',
      phase1: '/audio/playlists/long-night-dam/bgm2-phase1.mp3',
      phase2: '/audio/playlists/long-night-dam/bgm2-phase2.mp3',
      phase3: '/audio/playlists/long-night-dam/bgm2-phase3.mp3',
    },
  },
  original: {
    id: 'original',
    name: '《终于田园牧歌》',
    short: '第一版 · 钢琴',
    tracks: {
      menu: '/audio/playlists/finally-pastoral/bgm-menu.wav',
      room: '/audio/playlists/finally-pastoral/bgm-room.wav',
      replay: '/audio/playlists/finally-pastoral/bgm-replay.wav',
      settings: '/audio/playlists/finally-pastoral/bgm-settings.wav',
      phase1: '/audio/playlists/finally-pastoral/bgm-ingame-1.wav',
      phase2: '/audio/playlists/finally-pastoral/bgm-ingame-2.wav',
      phase3: '/audio/playlists/finally-pastoral/bgm-ingame-3.wav',
    },
  },
};

export class BgmPlayer {
  constructor(pack = 'new') {
    this.volume = 0.35;
    this.pack = MUSIC_PACKS[pack] ? pack : 'new';
    this.scene = null;
    this.wanted = null;
    this.unlocked = false;
    this.active = null;
    this.players = new Map();
    this.fades = new WeakMap();
    this.bindUnlock();
  }

  bindUnlock() {
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('touchstart', unlock, true);
      if (this.wanted) this.setScene(this.wanted);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('touchstart', unlock, true);
  }

  setVolume(value) {
    const v = Number(value);
    this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.35;
    if (this.active) {
      const timer = this.fades.get(this.active);
      if (timer) {
        clearInterval(timer);
        this.fades.delete(this.active);
        this.active._fading = false;
      }
      this.active.volume = this.volume;
    }
  }

  setPack(pack) {
    if (!MUSIC_PACKS[pack] || this.pack === pack) return;
    if (this.active) {
      try { this.active.pause(); } catch {}
      this.active = null;
    }
    for (const audio of this.players.values()) {
      try { audio.pause(); } catch {}
    }
    this.players.clear();
    this.pack = pack;
    this.scene = null;
    if (this.unlocked && this.wanted) this.setScene(this.wanted);
  }

  get(scene) {
    const key = `${this.pack}:${scene}`;
    if (this.players.has(key)) return this.players.get(key);
    const src = MUSIC_PACKS[this.pack]?.tracks?.[scene];
    if (!src) return null;
    const audio = new Audio(src);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    this.players.set(key, audio);
    return audio;
  }

  fade(audio, target, duration = 1200, pauseAtEnd = false) {
    const oldTimer = this.fades.get(audio);
    if (oldTimer) clearInterval(oldTimer);
    const start = audio.volume;
    const startAt = performance.now();
    audio._fading = true;
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - startAt) / duration);
      audio.volume = Math.max(0, Math.min(1, start + (target - start) * t));
      if (t >= 1) {
        clearInterval(timer);
        this.fades.delete(audio);
        audio._fading = false;
        audio.volume = target;
        if (pauseAtEnd && target <= 0.001) audio.pause();
      }
    }, 40);
    this.fades.set(audio, timer);
  }

  setScene(scene) {
    if (!MUSIC_PACKS[this.pack]?.tracks?.[scene]) return;
    this.wanted = scene;
    if (!this.unlocked) return;
    if (this.scene === scene) {
      if (this.active && this.active.paused) this.active.play().catch(() => {});
      return;
    }
    const previous = this.active;
    const next = this.get(scene);
    if (!next) return;
    next.currentTime = 0;
    next.volume = 0;
    next.play().catch(() => {});
    this.active = next;
    this.scene = scene;
    this.fade(next, this.volume, 1200);
    if (previous && previous !== next) this.fade(previous, 0, 1200, true);
  }
}
