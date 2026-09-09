/* =============================================================================
 * spatial.js  --  uniform grid for neighbour queries.
 *
 * Built in from day one on purpose. The core loop is hundreds of aydins
 * flocking against dozens of gohids; all-pairs is O(n*m) and dies well before
 * the herd sizes this game is actually about.
 *
 * Everything here reuses buffers. Allocating a result array per entity per
 * frame produces GC hitches, and a GC hitch reads to the player as exactly the
 * stutter the grid exists to prevent -- so queries fill a caller-owned array
 * and cells are emptied with length = 0 rather than being reallocated.
 * ========================================================================== */
'use strict';

class SpatialGrid {
  constructor(cellSize, width, height) {
    this.cell = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }

  clear() {
    const c = this.cells;
    for (let i = 0; i < c.length; i++) if (c[i].length) c[i].length = 0;
  }

  _index(x, y) {
    const cx = U.clamp((x / this.cell) | 0, 0, this.cols - 1);
    const cy = U.clamp((y / this.cell) | 0, 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  insert(e) { this.cells[this._index(e.x, e.y)].push(e); }

  insertAll(list) {
    for (let i = 0; i < list.length; i++) this.insert(list[i]);
  }

  /* Fills `out` with every entity in the cells overlapping the radius.
   * Candidates are NOT distance-filtered -- the caller already needs the
   * distance for its own maths, so filtering here would compute it twice. */
  query(x, y, radius, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = U.clamp(((x - radius) / c) | 0, 0, this.cols - 1);
    const x1 = U.clamp(((x + radius) / c) | 0, 0, this.cols - 1);
    const y0 = U.clamp(((y - radius) / c) | 0, 0, this.rows - 1);
    const y1 = U.clamp(((y + radius) / c) | 0, 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells[row + cx];
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }

  /* Nearest entity, searching outward one cell ring at a time and stopping as
   * soon as a further ring cannot beat the best hit found so far. A gohid
   * hunting across an empty map would otherwise scan the whole grid. */
  nearest(x, y, maxRadius, filter) {
    const c = this.cell;
    const cx = U.clamp((x / c) | 0, 0, this.cols - 1);
    const cy = U.clamp((y / c) | 0, 0, this.rows - 1);
    const maxRing = Math.ceil(maxRadius / c);
    let best = null, bestD2 = maxRadius * maxRadius;

    for (let ring = 0; ring <= maxRing; ring++) {
      // Anything in this ring is at least (ring-1)*cell away; if that already
      // beats our best, no further ring can help.
      if (best && (ring - 1) * c > Math.sqrt(bestD2)) break;

      const x0 = cx - ring, x1 = cx + ring, y0 = cy - ring, y1 = cy + ring;
      for (let gy = y0; gy <= y1; gy++) {
        if (gy < 0 || gy >= this.rows) continue;
        const onYEdge = (gy === y0 || gy === y1);
        const row = gy * this.cols;
        for (let gx = x0; gx <= x1; gx++) {
          // Only walk the perimeter of the ring; the interior was done already.
          if (!onYEdge && gx !== x0 && gx !== x1) continue;
          if (gx < 0 || gx >= this.cols) continue;
          const bucket = this.cells[row + gx];
          for (let i = 0; i < bucket.length; i++) {
            const e = bucket[i];
            if (filter && !filter(e)) continue;
            const d2 = U.dist2(x, y, e.x, e.y);
            if (d2 < bestD2) { bestD2 = d2; best = e; }
          }
        }
      }
    }
    return best;
  }
}
