/* =============================================================================
 * pickups.js  --  ground items and chests.
 *
 * Both are the same thing to the player: something lying in the world that you
 * walk into. So they share one spawn/expire/magnet/collect path and differ
 * only in what collecting them does. A chest opens into upgrade cards; a
 * pickup fires its effect immediately.
 *
 * Nothing here is a decision. A chest is a GIFT -- it hands over its cards
 * with a reveal and no choice screen, because the game already asks the player
 * to choose every level and a second chooser would dilute that one. The single
 * exception is the Cursed Idol, which is deliberately a real choice: it pays
 * well and it spawns three gohids, and it is marked in the threat colour so
 * nobody takes it by accident.
 *
 * The magnet range is not a constant: Sharp Eyes multiplies it and the Scout
 * triples it, so the pull is asked for through Tools.magnetRange() rather than
 * read from config directly.
 * ========================================================================== */
'use strict';

const Pickups = {
  items: [],       // ground pickups
  chests: [],
  timer: 0,
  chestTimer: 0,

  reset() {
    Pickups.items.length = 0;
    Pickups.chests.length = 0;
    Pickups.timer = CFG.pickups.interval;
    Pickups.chestTimer = CFG.chests.interval;
    Game.pickups = Pickups.items;
    Game.chests = Pickups.chests;
  },

  /* ------------------------------------------------------------- spawning */

  update(dt) {
    const P = CFG.pickups;
    const ramp = Math.min(1, Game.time / P.rampTime);

    Pickups.timer -= dt;
    if (Pickups.timer <= 0) {
      Pickups.timer = U.lerp(P.interval, P.intervalMin, ramp);
      if (Pickups.items.length < P.maxAlive) Pickups.spawn();
    }

    const C = CFG.chests;
    const cramp = Math.min(1, Game.time / C.rampTime);
    Pickups.chestTimer -= dt;
    if (Pickups.chestTimer <= 0) {
      Pickups.chestTimer = U.lerp(C.interval, C.intervalMin, cramp);
      if (Pickups.chests.length < C.maxAlive) Pickups.spawnChest();
    }

    Pickups._updateItems(dt);
    Pickups._updateChests(dt);
  },

  _placeNear(min, max) {
    const c = Game.commander;
    const a = U.rand(0, Math.PI * 2);
    const d = U.rand(min, max);
    return {
      x: U.clamp(c.x + Math.cos(a) * d, CFG.world.edgePad, CFG.world.width - CFG.world.edgePad),
      y: U.clamp(c.y + Math.sin(a) * d, CFG.world.edgePad, CFG.world.height - CFG.world.edgePad),
    };
  },

  spawn(forceKind) {
    const P = CFG.pickups;
    const kind = forceKind || Pickups._rollKind();
    const at = Pickups._placeNear(P.spawnMin, P.spawnMax);
    Pickups.items.push({
      kind: kind, x: at.x, y: at.y, t: P.life, max: P.life,
      bob: Math.random() * 10,
    });
  },

  _rollKind() {
    let total = 0;
    const ids = [];
    for (const id in CFG.pickups.kinds) {
      ids.push(id);
      total += CFG.pickups.kinds[id].weight;
    }
    let r = Math.random() * total;
    for (let i = 0; i < ids.length; i++) {
      r -= CFG.pickups.kinds[ids[i]].weight;
      if (r <= 0) return ids[i];
    }
    return ids[0];
  },

  spawnChest() {
    const C = CFG.chests;
    const at = Pickups._placeNear(C.spawnMin, C.spawnMax);
    Pickups.chests.push({
      tier: Pickups._rollTier(), x: at.x, y: at.y,
      t: C.life, max: C.life, bob: Math.random() * 10,
    });
  },

  /* Luck moves weight off the common tier and onto the better ones, rather
   * than simply adding to everything -- so Clover changes what you get, not
   * just how often you get something. */
  _rollTier() {
    const luck = (Game.buffs ? Game.buffs.luck : 0) * CFG.chests.luckShift;
    const tiers = CFG.chests.tiers;
    let total = 0;
    const w = tiers.map((t, i) => {
      const shift = (i === 0) ? (1 - luck) : (1 + luck * (i + 1));
      const v = Math.max(0.01, t.weight * shift);
      total += v;
      return v;
    });
    let r = Math.random() * total;
    for (let i = 0; i < tiers.length; i++) {
      r -= w[i];
      if (r <= 0) return tiers[i];
    }
    return tiers[0];
  },

  /* --------------------------------------------------------------- items */

  _updateItems(dt) {
    const P = CFG.pickups;
    const c = Game.commander;
    const magnet = P.magnet * Tools.magnetRange();
    const grab = P.radius + CFG.commander.radius;

    for (let i = Pickups.items.length - 1; i >= 0; i--) {
      const it = Pickups.items[i];
      it.t -= dt;
      it.bob += dt * 4;
      if (it.t <= 0) { Pickups.items.splice(i, 1); continue; }

      const dx = c.x - it.x, dy = c.y - it.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < magnet && d > 0.01) {
        // Pull harder the closer it is, so the last stretch snaps in.
        const pull = P.magnetPull * (1 - d / magnet);
        it.x += (dx / d) * pull * dt;
        it.y += (dy / d) * pull * dt;
      }
      if (d < grab) {
        Pickups.collect(it);
        Pickups.items.splice(i, 1);
      }
    }
  },

  collect(it) {
    let kind = it.kind;
    if (kind === 'mystery') {
      // Re-roll into anything except another mystery.
      do { kind = Pickups._rollKind(); } while (kind === 'mystery');
    }
    const k = CFG.pickups.kinds[kind];
    const c = Game.commander;

    Particles.burst(it.x, it.y, 14, {
      speed: 170, life: 0.45, size: 3, colour: k.colour,
    });
    Game.stats.pickups++;

    switch (kind) {
      case 'feed': {
        for (let i = 0; i < k.aydins; i++) {
          const a = (Math.PI * 2 * i) / k.aydins;
          Game.aydins.push(new Aydin(c.x + Math.cos(a) * 44, c.y + Math.sin(a) * 44, false));
        }
        UI.banner('+' + k.aydins + ' AYDINS', 'event');
        Audio2.recruit();
        break;
      }
      case 'totem': {
        const g = Game.gohidGrid.nearest(c.x, c.y, 3000, (x) => !x.leaving);
        if (g) Game.banishGohid(g);
        UI.banner('BANISHED', 'level');
        break;
      }
      case 'shard':
        Game.score += k.score * Game.mods.scoreMul;
        UI.banner('+' + U.formatNum(k.score), 'event');
        Audio2.chest();
        break;
      case 'crystal':
        Game.exp += k.exp * Game.mods.expMul;
        Audio2.chestCard(0);
        break;
      case 'horn':
        // A free perfect rally: tight AND protected, without the speed cost.
        Game.hornT = k.rally;
        UI.banner('RALLY HORN', 'level');
        Audio2.rallySnap();
        break;
      case 'idol':
        Game.idolT = k.duration;
        Game.idolMul = k.scoreMul;
        for (let i = 0; i < k.gohids; i++) Game.spawnAmbientGohid();
        UI.banner('CURSED IDOL', 'bad', 'SCORE UP, AND THEY COME');
        Audio2.gohidSpawn();
        Game.recomputeMods();
        break;
    }
  },

  /* -------------------------------------------------------------- chests */

  _updateChests(dt) {
    const c = Game.commander;
    const grab = CFG.chests.radius + CFG.commander.radius;
    for (let i = Pickups.chests.length - 1; i >= 0; i--) {
      const ch = Pickups.chests[i];
      ch.t -= dt;
      ch.bob += dt * 3;
      if (ch.t <= 0) { Pickups.chests.splice(i, 1); continue; }
      if (U.dist2(c.x, c.y, ch.x, ch.y) < grab * grab) {
        Pickups.chests.splice(i, 1);
        Pickups.openChest(ch.tier);
      }
    }
  },

  /* No choice screen. The cards are taken automatically and shown as a
   * reveal -- the chest is the reward, not another decision. */
  openChest(tier) {
    const cards = Upgrades.offer(tier.cards);
    if (!cards.length) {
      // Everything is maxed; pay out in score rather than nothing at all.
      Game.score += 500 * tier.cards * Game.mods.scoreMul;
      UI.banner(tier.name, 'event', 'NOTHING LEFT TO LEARN');
      return;
    }
    for (let i = 0; i < cards.length; i++) Upgrades.take(cards[i].id);
    Game.stats.chests++;
    Audio2.chest();
    UI.showChest(tier, cards);
  },

  /* ---------------------------------------------------------------- draw */

  draw(ctx, view) {
    // Chests first, so a pickup lying on one is still visible.
    for (let i = 0; i < Pickups.chests.length; i++) {
      const ch = Pickups.chests[i];
      if (ch.x < view.x0 || ch.x > view.x1 || ch.y < view.y0 || ch.y > view.y1) continue;
      const bob = Math.round(Math.sin(ch.bob) * 2);
      const col = ch.tier.id === 'legendary' ? CFG.palette.aydin
                : ch.tier.id === 'rare' ? CFG.palette.rally : CFG.palette.text;
      Pickups._blink(ctx, ch);
      const x = Math.round(ch.x - 12), y = Math.round(ch.y - 14) + bob;
      ctx.fillStyle = CFG.palette.ink;
      ctx.fillRect(x - 2, y - 2, 28, 24);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 24, 20);
      ctx.fillStyle = CFG.palette.ink;
      ctx.fillRect(x, y + 8, 24, 4);
      ctx.fillRect(x + 10, y + 6, 4, 8);
      // Tier is worth reading before you cross the map for it.
      const mark = ch.tier.id === 'legendary' ? '*'
                 : ch.tier.id === 'rare' ? '+' : '';
      if (mark) Render._badge(ctx, mark, ch.x, y - 4, col);
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < Pickups.items.length; i++) {
      const it = Pickups.items[i];
      if (it.x < view.x0 || it.x > view.x1 || it.y < view.y0 || it.y > view.y1) continue;
      const k = CFG.pickups.kinds[it.kind];
      const bob = Math.round(Math.sin(it.bob) * 2);
      Pickups._blink(ctx, it);
      const x = Math.round(it.x - 8), y = Math.round(it.y - 8) + bob;
      ctx.fillStyle = CFG.palette.ink;
      ctx.fillRect(x - 2, y - 2, 20, 20);
      ctx.fillStyle = k.colour;
      ctx.fillRect(x, y, 16, 16);
      ctx.fillStyle = CFG.palette.ink;
      ctx.fillRect(x + 2, y + 2, 12, 12);
      // The badge letter. Without it every pickup is an anonymous coloured
      // square, and the one that matters most -- the Cursed Idol, which costs
      // as well as pays -- has to be unmistakable before you walk into it.
      Render._badge(ctx, k.badge, it.x, y + 13, k.colour);
      ctx.globalAlpha = 1;
    }
  },

  /* Blink out over the last three seconds, so nothing vanishes unannounced. */
  _blink(ctx, o) {
    if (o.t > 3) { ctx.globalAlpha = 1; return; }
    ctx.globalAlpha = (Math.floor(o.t * 6) & 1) ? 0.25 : 1;
  },
};
