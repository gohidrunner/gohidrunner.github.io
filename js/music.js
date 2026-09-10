/* =============================================================================
 * music.js  --  background music.
 *
 * DELIBERATELY NOT WEBAUDIO, unlike every sound effect in the game. Two
 * reasons, both about the game opening straight off the disk:
 *
 *   - decodeAudioData needs the file fetched first, and fetch/XHR is blocked
 *     on a file:// page. An <audio> element loads a local file fine.
 *   - Routing an <audio> element into WebAudio via createMediaElementSource
 *     taints the graph for a file:// source and can output silence.
 *
 * So music is plain HTMLAudioElements and crossfades are done by moving
 * `.volume` on a timer. That costs the effects a shared master gain, which is
 * why music has its own volume setting rather than sharing the SFX one.
 *
 * Browsers refuse to start audio before a user gesture. Every method here is
 * safe to call at any time: a request made too early is remembered and starts
 * on the first gesture instead of being lost.
 * ========================================================================== */
'use strict';

const Music = {
  enabled: true,
  volume: CFG.music.volume,
  current: null,        // track id
  _els: Object.create(null),
  _fading: [],
  _pending: null,
  _unlocked: false,
  _duck: 1,

  init() {
    Music.enabled = CFG.music.enabled;
    Music.volume = CFG.music.volume;
    if (typeof Save !== 'undefined' && Save.data) {
      const s = Save.settings;
      if (s.music != null) Music.enabled = s.music;
      if (s.musicVolume != null) Music.volume = s.musicVolume;
    }
  },

  /* Build (once) the element for a track, trying each candidate source in
   * order. `src` is a list because one of the songs is Opus in an MP4
   * container, which not every browser decodes. */
  _element(id) {
    if (Music._els[id]) return Music._els[id];
    const def = CFG.music.tracks[id];
    if (!def) return null;

    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;

    let i = 0;
    const tryNext = () => {
      if (i >= def.src.length) {
        console.warn('[music] no playable source for "' + id + '"');
        el.dataset.failed = '1';
        return;
      }
      el.src = def.src[i++];
      el.load();
    };
    // On a decode/404 failure, fall through to the next candidate rather than
    // leaving the track silently dead.
    el.addEventListener('error', tryNext);
    tryNext();

    Music._els[id] = el;
    return el;
  },

  /* Called from the first pointer/key event, alongside Audio2.resume(). */
  unlock() {
    Music._unlocked = true;
    if (Music._pending) {
      const id = Music._pending;
      Music._pending = null;
      Music.play(id);
    }
  },

  play(id) {
    if (!id || id === Music.current) return;
    if (!Music.enabled) { Music.current = id; return; }
    if (!Music._unlocked) { Music._pending = id; return; }

    const el = Music._element(id);
    if (!el) return;

    // Fade whatever is playing out; fade the new one in from wherever it is.
    if (Music.current && Music._els[Music.current] && Music.current !== id) {
      Music._fadeTo(Music._els[Music.current], 0, true);
    }
    Music.current = id;
    el.play().catch(() => {
      // Autoplay refused after all -- wait for the next gesture.
      Music._unlocked = false;
      Music._pending = id;
    });
    Music._fadeTo(el, 1, false);
  },

  stop() {
    for (const id in Music._els) Music._fadeTo(Music._els[id], 0, true);
    Music.current = null;
  },

  /* target is 0..1 of the configured volume; `pauseAtEnd` stops the element
   * once it reaches silence so it is not decoding in the background.
   * `secs` overrides the crossfade length -- ducking wants to be quick. */
  _fadeTo(el, target, pauseAtEnd, secs) {
    for (let i = Music._fading.length - 1; i >= 0; i--) {
      if (Music._fading[i].el === el) Music._fading.splice(i, 1);
    }
    Music._fading.push({
      el: el, target: target, pauseAtEnd: !!pauseAtEnd,
      secs: secs || CFG.music.fade,
    });
  },

  setEnabled(on) {
    Music.enabled = on;
    if (typeof Save !== 'undefined' && Save.data) Save.setSetting('music', on);
    if (!on) {
      for (const id in Music._els) {
        Music._els[id].pause();
        Music._els[id].volume = 0;
      }
      Music._fading.length = 0;
    } else if (Music.current) {
      const want = Music.current;
      Music.current = null;      // force play() to act
      Music.play(want);
    }
  },

  setVolume(v) {
    Music.volume = v;
    if (typeof Save !== 'undefined' && Save.data) Save.setSetting('musicVolume', v);
  },

  /* Quieten under a pausing screen rather than stopping: silence makes a
   * pause feel like a crash, and a hard cut on every level-up would be
   * constant. */
  duck(on) {
    const want = on ? CFG.music.duckWhilePaused : 1;
    if (want === Music._duck) return;
    Music._duck = want;
    // Changing the multiplier is not enough on its own: update() only moves
    // volumes for tracks currently fading, and after a crossfade settles that
    // list is empty -- so the duck had no audible effect at all. Re-target the
    // playing track so it actually travels to the new level.
    if (Music.enabled && Music.current && Music._els[Music.current]) {
      Music._fadeTo(Music._els[Music.current], 1, false, CFG.music.duckFade);
    }
  },

  update(dt) {
    if (!Music._fading.length) return;
    for (let i = Music._fading.length - 1; i >= 0; i--) {
      const f = Music._fading[i];
      const step = dt / Math.max(0.05, f.secs);
      const goal = f.target * Music.volume * Music._duck;
      const cur = f.el.volume;
      let next;
      if (cur < goal) next = Math.min(goal, cur + step);
      else next = Math.max(goal, cur - step);
      // Guard: volume outside 0..1 throws in some browsers.
      f.el.volume = U.clamp(next, 0, 1);
      if (Math.abs(next - goal) < 0.001) {
        f.el.volume = U.clamp(goal, 0, 1);
        if (f.pauseAtEnd && goal <= 0.0001) {
          f.el.pause();
          f.el.currentTime = 0;
        }
        Music._fading.splice(i, 1);
      }
    }
  },

  /* Live volume follow-up: the slider changes CFG-independent volume while a
   * track is already at full, and nothing would be fading to notice. */
  applyVolumeNow() {
    if (!Music.current) return;
    const el = Music._els[Music.current];
    if (el && !Music._fading.length) {
      el.volume = U.clamp(Music.volume * Music._duck, 0, 1);
    }
  },

  nowPlaying() {
    const def = Music.current ? CFG.music.tracks[Music.current] : null;
    return def ? def.title : null;
  },
};
