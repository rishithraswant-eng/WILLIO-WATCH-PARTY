import { seededRandom } from '@blockparty/shared';

/**
 * Procedural voxel swamp (deterministic). Units are "blocks" in a 192x108 scene.
 * Each layer is a list of rect runs: [x, y, w, h, color].
 */
export type Rect = [number, number, number, number, string];

export const SCENE_W = 192;
export const SCENE_H = 108;
const WATER_Y = 80;

function canopy(out: Rect[], rnd: () => number, cx: number, cy: number, rx: number, ry: number, shades: string[]) {
  for (let y = -ry; y <= ry; y++) {
    const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) + (rnd() - 0.5) * 2);
    if (span <= 0) continue;
    let x = cx - span;
    while (x < cx + span) {
      const w = 1 + Math.floor(rnd() * 3);
      const shade = shades[Math.min(shades.length - 1, Math.floor(rnd() * shades.length * (y < 0 ? 0.6 : 1)) + (y > ry / 2 ? 1 : 0))]!;
      out.push([x, cy + y, Math.min(w, cx + span - x), 1, shade]);
      x += w;
    }
  }
}

/** Layer 0: far tree line silhouettes. */
export function farLayer(): Rect[] {
  const rnd = seededRandom(11);
  const out: Rect[] = [];
  let x = -4;
  while (x < SCENE_W + 4) {
    const w = 5 + Math.floor(rnd() * 8);
    const h = 26 + Math.floor(rnd() * 22);
    const top = WATER_Y - h;
    out.push([x + Math.floor(w / 2), top + 8, 2, h - 8, '#0a231e']);
    canopy(out, rnd, x + Math.floor(w / 2), top + 6, Math.ceil(w / 1.4), 6 + Math.floor(rnd() * 3), ['#0b2d26', '#0d3229', '#0a2822']);
    x += w;
  }
  return out;
}

/** Layer 1: mangrove trees with roots, mossy canopies and hanging vines. */
export function midLayer(): Rect[] {
  const rnd = seededRandom(23);
  const out: Rect[] = [];
  const trees = [14, 46, 88, 128, 160, 186];
  for (const tx of trees) {
    const height = 46 + Math.floor(rnd() * 16);
    const top = WATER_Y - height;
    const tw = 3 + Math.floor(rnd() * 2);
    // trunk with light/dark sides
    for (let y = top + 6; y < WATER_Y; y++) {
      out.push([tx, y, 1, 1, '#6e4a2c']);
      out.push([tx + 1, y, tw - 1, 1, y % 5 === 0 ? '#3e2817' : '#5b3b24']);
      if (rnd() < 0.08) out.push([tx + Math.floor(rnd() * tw), y, 1, 1, '#4d7d22']);
    }
    // stilt roots stepping into the water
    for (const dir of [-1, 1]) {
      for (let r = 0; r < 2; r++) {
        let rx = tx + (dir < 0 ? 0 : tw - 1);
        let ry = WATER_Y - 10 - r * 4;
        while (ry < WATER_Y + 3) {
          out.push([rx, ry, 1, 2, '#4a301c']);
          rx += dir;
          ry += 1 + Math.floor(rnd() * 2);
        }
      }
    }
    // canopy
    canopy(out, rnd, tx + 1, top + 4, 11 + Math.floor(rnd() * 5), 6 + Math.floor(rnd() * 2), ['#1d4a1f', '#245a22', '#2a6624', '#163d1a']);
    // moss highlights on top
    for (let i = 0; i < 16; i++) out.push([tx - 9 + Math.floor(rnd() * 20), top - 2 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 2), 1, '#7bbf2f']);
    // vines
    for (let v = 0; v < 6; v++) {
      const vx = tx - 9 + Math.floor(rnd() * 20);
      const len = 4 + Math.floor(rnd() * 14);
      out.push([vx, top + 8, 1, len, '#2f6b2a']);
      if (rnd() < 0.5) out.push([vx, top + 8 + len, 1, 1, '#3ddc84']);
    }
  }
  return out;
}

/** Layer 2: water plane with light strips, lily pads and reeds. */
export function waterLayer(): Rect[] {
  const rnd = seededRandom(37);
  const out: Rect[] = [];
  for (let y = WATER_Y; y < SCENE_H; y++) {
    out.push([0, y, SCENE_W, 1, y < WATER_Y + 2 ? '#0c3a33' : y % 3 === 0 ? '#062a26' : '#05241f']);
  }
  // light reflections
  for (let i = 0; i < 70; i++) {
    const y = WATER_Y + 1 + Math.floor(rnd() * (SCENE_H - WATER_Y - 2));
    out.push([Math.floor(rnd() * SCENE_W), y, 2 + Math.floor(rnd() * 8), 1, rnd() < 0.7 ? '#126055' : '#19c3a6']);
  }
  // lily pads
  for (let i = 0; i < 26; i++) {
    const px = Math.floor(rnd() * SCENE_W);
    const py = WATER_Y + 3 + Math.floor(rnd() * 22);
    const w = 3 + Math.floor(rnd() * 3);
    out.push([px, py, w, 1, '#2f7a2a']);
    out.push([px + 1, py - 1, w - 2, 1, '#3b9430']);
    if (rnd() < 0.25) out.push([px + 1, py - 2, 1, 1, '#ff9ecb']);
  }
  // reeds
  for (let i = 0; i < 18; i++) {
    const rx = Math.floor(rnd() * SCENE_W);
    const h = 3 + Math.floor(rnd() * 6);
    out.push([rx, WATER_Y - h + 1, 1, h, '#4d7d22']);
    if (rnd() < 0.4) out.push([rx, WATER_Y - h - 1, 1, 2, '#5b3b24']);
  }
  return out;
}

/** Layer 3: foreground silhouettes + lantern post. Returns rects and the lantern position. */
export function frontLayer(): { rects: Rect[]; lantern: { x: number; y: number } } {
  const rnd = seededRandom(51);
  const out: Rect[] = [];
  // corner silhouettes (big blocky roots/leaves)
  for (const side of [0, 1]) {
    for (let i = 0; i < 26; i++) {
      const w = 2 + Math.floor(rnd() * 6);
      const h = 2 + Math.floor(rnd() * 8);
      const x = side === 0 ? Math.floor(rnd() * 26) - 4 : SCENE_W - Math.floor(rnd() * 26) - w + 4;
      const y = SCENE_H - Math.floor(rnd() * 22) - h + 4;
      out.push([x, y, w, h, rnd() < 0.5 ? '#020a08' : '#031210']);
    }
  }
  // lantern post on the right third
  const lx = 140;
  const ly = 64;
  for (let y = ly + 4; y < SCENE_H; y++) out.push([lx, y, 2, 1, y % 4 === 0 ? '#3e2817' : '#5b3b24']);
  out.push([lx - 2, ly + 3, 6, 1, '#3e2817']);
  out.push([lx - 1, ly - 2, 4, 1, '#2a2a2a']);
  out.push([lx - 1, ly - 1, 4, 4, '#ffcf5c']);
  out.push([lx, ly, 2, 2, '#fff1b8']);
  out.push([lx - 1, ly + 3, 4, 1, '#2a2a2a']);
  return { rects: out, lantern: { x: lx + 1, y: ly + 1 } };
}
