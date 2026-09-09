/* =============================================================================
 * particles.js  --  pooled square particles.
 *
 * Particles are filled squares, never circles -- arc() on a pixel-art game both
 * looks wrong and costs far more than fillRect at these counts.
 *
 * The pool is allocated once and never grows: spawning past the cap overwrites
 * the oldest particle instead of allocating. Effects fire in bursts of dozens
 * during exactly the moments the frame budget is tightest, so this is the one
 * place where dropping a particle is much better than allocating one.
 * ========================================================================== */
'use strict';

const Particles = {
  pool: [],
  head: 0,
  live: 0,

  init() {
    const n = CFG.fx.maxParticles;
    Particles.pool = new Array(n);
    for (let i = 0; i < n; i++) {
      Particles.pool[i] = {
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 2, colour: '#fff',
        drag: 3, gravity: 0, fade: true,
      };
    }
    Particles.head = 0;
    Particles.live = 0;
  },

  _next() {
    const p = Particles.pool[Particles.head];
    Particles.head = (Particles.head + 1) % Particles.pool.length;
    if (!p.active) Particles.live++;
    return p;
  },

  spawn(x, y, opts) {
    const p = Particles._next();
    p.active = true;
    p.x = x; p.y = y;
    p.vx = opts.vx || 0;
    p.vy = opts.vy || 0;
    p.maxLife = p.life = opts.life || 0.5;
    p.size = opts.size || 3;
    p.colour = opts.colour || '#fff';
    p.drag = opts.drag == null ? 3 : opts.drag;
    p.gravity = opts.gravity || 0;
    p.fade = opts.fade !== false;
    return p;
  },

  /* A ring of outward-flying squares. Used for the rally snap, gohid spawn
   * telegraph, scatter, and captures -- the shape reads instantly as "something
   * happened HERE". */
  burst(x, y, count, opts) {
    const o = opts || {};
    const speed = o.speed || 120;
    const spread = o.spread == null ? 0.45 : o.spread;
    const base = o.angle == null ? Math.random() * Math.PI * 2 : o.angle;
    const arc = o.arc == null ? Math.PI * 2 : o.arc;
    for (let i = 0; i < count; i++) {
      const a = base + (arc * i / count) + U.rand(-0.12, 0.12);
      const s = speed * U.rand(1 - spread, 1 + spread);
      Particles.spawn(x + Math.cos(a) * (o.radius || 0),
                      y + Math.sin(a) * (o.radius || 0), {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: (o.life || 0.5) * U.rand(0.7, 1.2),
        size: o.size || 3,
        colour: o.colour || '#fff',
        drag: o.drag == null ? 3 : o.drag,
        gravity: o.gravity || 0,
      });
    }
  },

  /* An inward-collapsing ring -- the visual counterpart of the herd snapping
   * together on rally. Particles start on the ring and fly toward the centre. */
  implode(x, y, count, radius, opts) {
    const o = opts || {};
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i / count) + U.rand(-0.1, 0.1);
      const r = radius * U.rand(0.85, 1.1);
      const s = o.speed || 200;
      Particles.spawn(x + Math.cos(a) * r, y + Math.sin(a) * r, {
        vx: -Math.cos(a) * s,
        vy: -Math.sin(a) * s,
        life: (o.life || 0.35) * U.rand(0.8, 1.2),
        size: o.size || 3,
        colour: o.colour || CFG.palette.dust,
        drag: o.drag == null ? 4 : o.drag,
      });
    }
  },

  update(dt) {
    const pool = Particles.pool;
    let live = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      live++;
    }
    Particles.live = live;
  },

  /* Drawn in world space; the caller has already applied the camera transform.
   * Alpha is quantised so particles visibly step out rather than fading
   * smoothly, matching the limited-frame look of everything else. */
  draw(ctx, view) {
    const pool = Particles.pool;
    let lastAlpha = -1;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p.active) continue;
      if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
      const t = p.life / p.maxLife;
      const a = p.fade ? Math.max(0.15, U.quantise(t, 4)) : 1;
      if (a !== lastAlpha) { ctx.globalAlpha = a; lastAlpha = a; }
      ctx.fillStyle = p.colour;
      const s = p.size;
      ctx.fillRect((p.x - s / 2) | 0, (p.y - s / 2) | 0, s, s);
    }
    ctx.globalAlpha = 1;
  },

  clear() {
    const pool = Particles.pool;
    for (let i = 0; i < pool.length; i++) pool[i].active = false;
    Particles.live = 0;
  },
};
