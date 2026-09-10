/* =============================================================================
 * input.js  --  keyboard, mouse and touch, normalised to two outputs:
 *
 *     Input.mx, Input.my   movement vector, magnitude 0..1
 *     Input.rally          boolean, held
 *
 * The rest of the game never asks where the input came from.
 *
 * The mobile joystick is FLOATING: it appears wherever the thumb first lands
 * on the left half of the screen rather than sitting in a fixed corner. A
 * pinned stick forces the player to look down at their thumb; a floating one
 * lets them keep their eyes on the herd.
 * ========================================================================== */
'use strict';

const Input = {
  mx: 0, my: 0,
  rally: false,
  rallyPressed: false,     // edge, consumed by the game each frame
  rallyReleased: false,
  anyPressed: false,

  keys: Object.create(null),
  touchEnabled: false,
  touchMode: 'auto',        // Settings > TOUCH CONTROLS: auto | on | off

  stick: {
    active: false, id: null,
    ox: 0, oy: 0,          // origin, css px
    cx: 0, cy: 0,          // current, css px
  },
  rallyTouchId: null,

  _canvas: null,
  _onFirstGesture: null,

  init(canvas, onFirstGesture) {
    Input._canvas = canvas;
    Input._onFirstGesture = onFirstGesture;
    Input.touchEnabled = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    window.addEventListener('keydown', Input._keydown, { passive: false });
    window.addEventListener('keyup', Input._keyup);
    window.addEventListener('blur', Input._blur);

    canvas.addEventListener('touchstart', Input._touchStart, { passive: false });
    canvas.addEventListener('touchmove', Input._touchMove, { passive: false });
    canvas.addEventListener('touchend', Input._touchEnd, { passive: false });
    canvas.addEventListener('touchcancel', Input._touchEnd, { passive: false });

    // Right mouse button also rallies, for players who would rather not
    // hold space with the same hand they steer with.
    canvas.addEventListener('mousedown', Input._mouseDown);
    window.addEventListener('mouseup', Input._mouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  _gesture() {
    if (Input._onFirstGesture) { Input._onFirstGesture(); Input._onFirstGesture = null; }
  },

  /* Whether touch may steer. "off" exists for hybrid laptops, where a stray
   * palm on the screen otherwise fights the keyboard. */
  _touchActive() { return Input.touchMode !== 'off'; },

  /* ---------------------------------------------------------- keyboard */

  _keydown(e) {
    Input._gesture();
    const k = e.key.toLowerCase();
    // Space scrolls the page and arrows scroll the document -- both would
    // shove the canvas around mid-run.
    if (k === ' ' || k === 'spacebar' || e.key.startsWith('Arrow')) e.preventDefault();
    if (Input.keys[k]) return;   // ignore auto-repeat
    Input.keys[k] = true;
    Input.anyPressed = true;
    if (k === ' ' || k === 'spacebar') {
      if (!Input.rally) Input.rallyPressed = true;
      Input.rally = true;
    }
  },

  _keyup(e) {
    const k = e.key.toLowerCase();
    Input.keys[k] = false;
    if (k === ' ' || k === 'spacebar') {
      if (Input.rally) Input.rallyReleased = true;
      Input.rally = Input.rallyTouchId !== null;
    }
  },

  /* A lost window means keys never receive their keyup -- without this the
   * commander walks into the far wall while the player is in another tab. */
  _blur() {
    for (const k in Input.keys) Input.keys[k] = false;
    if (Input.rally) Input.rallyReleased = true;
    Input.rally = false;
    Input.stick.active = false;
    Input.stick.id = null;
    Input.rallyTouchId = null;
  },

  /* ------------------------------------------------------------- mouse */

  _mouseDown(e) {
    Input._gesture();
    if (e.button === 2) {
      if (!Input.rally) Input.rallyPressed = true;
      Input.rally = true;
    }
  },

  _mouseUp(e) {
    if (e.button === 2) {
      if (Input.rally) Input.rallyReleased = true;
      Input.rally = false;
    }
  },

  /* ------------------------------------------------------------- touch */

  _isRallyZone(x, y) {
    // Right third of the screen, lower half -- matches the on-screen button.
    return x > window.innerWidth * 0.62 && y > window.innerHeight * 0.45;
  },

  _touchStart(e) {
    Input._gesture();
    if (!Input._touchActive()) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (Input._isRallyZone(t.clientX, t.clientY)) {
        if (Input.rallyTouchId === null) {
          Input.rallyTouchId = t.identifier;
          if (!Input.rally) Input.rallyPressed = true;
          Input.rally = true;
        }
      } else if (!Input.stick.active) {
        Input.stick.active = true;
        Input.stick.id = t.identifier;
        Input.stick.ox = Input.stick.cx = t.clientX;
        Input.stick.oy = Input.stick.cy = t.clientY;
      }
    }
  },

  _touchMove(e) {
    if (!Input._touchActive()) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (Input.stick.active && t.identifier === Input.stick.id) {
        Input.stick.cx = t.clientX;
        Input.stick.cy = t.clientY;
      }
    }
  },

  _touchEnd(e) {
    if (!Input._touchActive()) return;
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === Input.stick.id) {
        Input.stick.active = false;
        Input.stick.id = null;
      }
      if (t.identifier === Input.rallyTouchId) {
        Input.rallyTouchId = null;
        if (!Input.keys[' ']) {
          if (Input.rally) Input.rallyReleased = true;
          Input.rally = false;
        }
      }
    }
  },

  /* ------------------------------------------------------------ update */

  /* Resolves keyboard and stick into one vector. Called once per frame,
   * before the game reads mx/my. */
  update() {
    let x = 0, y = 0;
    const k = Input.keys;
    if (k['a'] || k['arrowleft'])  x -= 1;
    if (k['d'] || k['arrowright']) x += 1;
    if (k['w'] || k['arrowup'])    y -= 1;
    if (k['s'] || k['arrowdown'])  y += 1;

    if (x !== 0 || y !== 0) {
      const len = Math.sqrt(x * x + y * y);
      x /= len; y /= len;
    } else if (Input.stick.active) {
      const dx = Input.stick.cx - Input.stick.ox;
      const dy = Input.stick.cy - Input.stick.oy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > CFG.input.joystickDead) {
        const mag = Math.min(1, len / CFG.input.joystickRadius);
        x = (dx / len) * mag;
        y = (dy / len) * mag;
      }
    }
    Input.mx = x;
    Input.my = y;
  },

  /* Edge flags are consumed, not read -- so a single press fires one snap
   * even if two systems ask about it. */
  consumeRallyPressed() { const v = Input.rallyPressed; Input.rallyPressed = false; return v; },
  consumeRallyReleased() { const v = Input.rallyReleased; Input.rallyReleased = false; return v; },
};
