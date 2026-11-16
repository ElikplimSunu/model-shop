// A building described as numbers (metres), turned into exact pieces for the 3D view.
// Generative models guess shapes; drawings carry measurements, so buildings are built, not generated.

export type Point = [number, number]; // plan coordinates in metres: x to the right, y up the sheet (north)

export type Opening = {
  wall: number; // index: outline edges first (edge i runs from outline[i] to outline[i + 1]), then interior walls
  at: number; // distance from the wall's start point to the near edge of the opening, along the centreline
  width: number;
  height: number;
  sill?: number; // windows: height of the bottom edge above the floor; doors have none
  kind?: 'door' | 'window';
};

export type Level = {
  name: string;
  height: number; // floor to ceiling
  outline: Point[]; // exterior wall centrelines, as a closed loop
  walls?: [Point, Point][]; // interior walls, centrelines
  openings?: Opening[];
};

export type Building = { name: string; wallThickness: number; slab?: number; levels: Level[] };

// Three.js space: x = plan x, y = up, z = -plan y (so north stays up the screen from above).
export type Piece =
  | { kind: 'wall' | 'glass'; center: [number, number, number]; size: [number, number, number]; rotY: number }
  | { kind: 'slab'; outline: Point[]; y: number; thickness: number; roof?: boolean };

export type Wall = { from: Point; to: Point; length: number; exterior: boolean };

const len = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(bx - ax, by - ay);

export function wallsOf(level: Level): Wall[] {
  const n = level.outline.length;
  const outer = level.outline.map((p, i) => ({ from: p, to: level.outline[(i + 1) % n], exterior: true }));
  const inner = (level.walls ?? []).map(([a, b]) => ({ from: a, to: b, exterior: false }));
  return [...outer, ...inner].map((w) => ({ ...w, length: len(w.from, w.to) }));
}

/** Outside size in metres: plan extents of the centrelines plus one wall thickness, and total height. */
export function extents(b: Building) {
  const pts = b.levels.flatMap((l) => l.outline);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const slab = b.slab ?? 0.2;
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs) + b.wallThickness,
    depth: Math.max(...ys) - Math.min(...ys) + b.wallThickness,
    height: b.levels.reduce((h, l) => h + l.height, 0) + slab * (b.levels.length - 1),
  };
}

/** Shoelace formula: plan area inside the wall centrelines, in square metres. */
export const area = (pts: Point[]) =>
  Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

/** Everything wrong with a spec, in plain words. Empty means it can be built. */
export function problems(b: Building): string[] {
  const out: string[] = [];
  if (!(b.wallThickness > 0)) out.push('wallThickness must be a positive number of metres.');
  if (!b.levels?.length) out.push('Add at least one level.');
  b.levels?.forEach((lv, li) => {
    const where = `Level ${li + 1} (${lv.name})`;
    if (!(lv.height > 0)) out.push(`${where}: height must be positive.`);
    if (!(lv.outline?.length >= 3)) return out.push(`${where}: the outline needs at least 3 corners.`);
    const pts = [...lv.outline, ...(lv.walls ?? []).flat()];
    if (!pts.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return out.push(`${where}: every corner must be [x, y] in metres.`);
    const walls = wallsOf(lv);
    (lv.openings ?? []).forEach((o, oi) => {
      const w = walls[o.wall];
      const name = `${where}, opening ${oi + 1}`;
      if (!w) return out.push(`${name}: there is no wall ${o.wall} (this level has walls 0 to ${walls.length - 1}).`);
      if (!(o.width > 0 && o.height > 0 && o.at >= 0)) return out.push(`${name}: needs a positive width and height, and at of 0 or more.`);
      if (o.at < 0 || o.at + o.width > w.length + 1e-9) out.push(`${name}: runs past the end of wall ${o.wall}, which is ${w.length.toFixed(2)} m long.`);
      if ((o.sill ?? 0) + o.height > lv.height + 1e-9) out.push(`${name}: its top is above the ceiling.`);
    });
  });
  return out;
}

/**
 * Cut each wall into solid boxes around its openings. Walls are extended by half their thickness at
 * both ends so corners close; lengths in the spec are centreline lengths, as on most dimension strings.
 */
export function pieces(b: Building): Piece[] {
  const t = b.wallThickness;
  const slab = b.slab ?? 0.2;
  const out: Piece[] = [];
  let floor = 0;
  b.levels.forEach((lv) => {
    out.push({ kind: 'slab', outline: lv.outline, y: floor - slab, thickness: slab });
    wallsOf(lv).forEach((w, wi) => {
      const th = Math.atan2(w.to[1] - w.from[1], w.to[0] - w.from[0]);
      const box = (s0: number, s1: number, y0: number, y1: number, kind: 'wall' | 'glass' = 'wall', depth = t) => {
        if (s1 - s0 < 1e-6 || y1 - y0 < 1e-6) return;
        const c = (s0 + s1) / 2;
        out.push({
          kind, rotY: th, size: [s1 - s0, y1 - y0, depth],
          center: [w.from[0] + Math.cos(th) * c, floor + (y0 + y1) / 2, -(w.from[1] + Math.sin(th) * c)],
        });
      };
      const holes = (lv.openings ?? []).filter((o) => o.wall === wi).sort((a, z) => a.at - z.at);
      let cursor = -t / 2;
      for (const o of holes) {
        const bottom = o.kind === 'door' || o.sill === undefined ? 0 : o.sill;
        box(cursor, o.at, 0, lv.height);
        box(o.at, o.at + o.width, 0, bottom); // below a window
        box(o.at, o.at + o.width, bottom + o.height, lv.height); // above the opening
        if (bottom > 0) box(o.at, o.at + o.width, bottom, bottom + o.height, 'glass', 0.02);
        cursor = o.at + o.width;
      }
      box(cursor, w.length + t / 2, 0, lv.height);
    });
    floor += lv.height + slab;
  });
  out.push({ kind: 'slab', outline: b.levels[b.levels.length - 1].outline, y: floor - slab, thickness: slab, roof: true }); // flat roof
  return out;
}

export const SAMPLES: Building[] = [
  {
    name: 'Studio, 6 by 4 m',
    wallThickness: 0.2,
    levels: [{
      name: 'Ground', height: 2.7,
      outline: [[0, 0], [6, 0], [6, 4], [0, 4]],
      openings: [
        { wall: 0, at: 1, width: 0.9, height: 2.1, kind: 'door' },
        { wall: 0, at: 3.4, width: 1.8, height: 1.2, sill: 0.9, kind: 'window' },
        { wall: 2, at: 2.1, width: 1.8, height: 1.2, sill: 0.9, kind: 'window' },
      ],
    }],
  },
  {
    name: 'Two-bedroom bungalow, 12 by 8 m',
    wallThickness: 0.23,
    levels: [{
      name: 'Ground', height: 3,
      outline: [[0, 0], [12, 0], [12, 8], [0, 8]],
      walls: [[[6, 0], [6, 8]], [[6, 4], [12, 4]]],
      openings: [
        { wall: 0, at: 2.4, width: 1, height: 2.1, kind: 'door' },
        { wall: 0, at: 7.5, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
        { wall: 1, at: 1.25, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
        { wall: 1, at: 5.25, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
        { wall: 2, at: 8, width: 2.4, height: 1.5, sill: 0.9, kind: 'window' },
        { wall: 3, at: 3, width: 2, height: 1.2, sill: 1, kind: 'window' },
        { wall: 4, at: 1.5, width: 0.9, height: 2.1, kind: 'door' },
        { wall: 4, at: 5.6, width: 0.9, height: 2.1, kind: 'door' },
      ],
    }],
  },
  {
    name: 'Two-storey house, 9 by 7 m',
    wallThickness: 0.23,
    levels: [
      {
        name: 'Ground', height: 3,
        outline: [[0, 0], [9, 0], [9, 7], [0, 7]],
        walls: [[[5, 0], [5, 7]]],
        openings: [
          { wall: 0, at: 1.5, width: 1.2, height: 2.4, kind: 'door' },
          { wall: 0, at: 6, width: 2, height: 1.5, sill: 0.9, kind: 'window' },
          { wall: 2, at: 1, width: 3, height: 2.2, sill: 0.3, kind: 'window' },
          { wall: 4, at: 3, width: 0.9, height: 2.1, kind: 'door' },
        ],
      },
      {
        name: 'First floor', height: 2.8,
        outline: [[0, 0], [9, 0], [9, 7], [0, 7]],
        walls: [[[4.5, 0], [4.5, 7]]],
        openings: [
          { wall: 0, at: 1.2, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
          { wall: 0, at: 6.2, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
          { wall: 2, at: 1.2, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
          { wall: 2, at: 6.2, width: 1.5, height: 1.2, sill: 1, kind: 'window' },
          { wall: 4, at: 3, width: 0.9, height: 2.1, kind: 'door' },
        ],
      },
    ],
  },
];
