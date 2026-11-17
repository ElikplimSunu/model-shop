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

export type Building = {
  name: string; wallThickness: number; slab?: number; levels: Level[];
  base?: number; // floor level of the first level, metres from the ground: -8.4 puts three 2.8 m basements underground
  parapet?: number; // solid wall round the roof edge, metres above the roof
  balustrade?: number; // glass on top of the parapet, metres
  // ground round the building, metres from the ground floor (0). The first entry is the ground everywhere else;
  // each later one covers only its outline: a sunken yard, a raised terrace. Default: just under the ground-floor slab.
  site?: { level: number; outline?: Point[] }[];
};

// Three.js space: x = plan x, y = up, z = -plan y (so north stays up the screen from above).
export type Piece =
  | { kind: 'wall' | 'glass' | 'frame'; center: [number, number, number]; size: [number, number, number]; rotY: number; exterior?: boolean; roof?: boolean }
  | { kind: 'slab'; outline: Point[]; y: number; thickness: number; roof?: boolean };

export type Wall = { from: Point; to: Point; length: number; exterior: boolean };

const len = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(bx - ax, by - ay);

export function wallsOf(level: Level): Wall[] {
  const n = level.outline.length;
  const outer = level.outline.map((p, i) => ({ from: p, to: level.outline[(i + 1) % n], exterior: true }));
  const inner = (level.walls ?? []).map(([a, b]) => ({ from: a, to: b, exterior: false }));
  return [...outer, ...inner].map((w) => ({ ...w, length: len(w.from, w.to) }));
}

/** Outside size in metres: plan extents of the centrelines plus one wall thickness; height from the ground to the top of the roof slab, and depth below ground. */
export function extents(b: Building) {
  const pts = b.levels.flatMap((l) => l.outline);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const slab = b.slab ?? 0.2;
  const base = b.base ?? 0;
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs) + b.wallThickness,
    depth: Math.max(...ys) - Math.min(...ys) + b.wallThickness,
    height: base + b.levels.reduce((h, l) => h + l.height, 0) + slab * b.levels.length, // floors between levels, plus the roof
    below: Math.max(0, -base),
    ground: b.site?.[0]?.level ?? 0, // the main ground level, for heights measured from the ground
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
  b.site?.slice(1).forEach((a, i) => { if ((a.outline?.length ?? 0) < 3) out.push(`site area ${i + 2} needs an outline of at least 3 corners.`); });
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
  const F = 0.05; // window frame width
  const out: Piece[] = [];
  // A box along wall w: s0 to s1 along its centreline, y0 to y1 above `at` (the floor it stands on).
  const box = (w: Wall, at: number, s0: number, s1: number, y0: number, y1: number, kind: 'wall' | 'glass' | 'frame' = 'wall', depth = t, roof = false) => {
    if (s1 - s0 < 1e-6 || y1 - y0 < 1e-6) return;
    const th = Math.atan2(w.to[1] - w.from[1], w.to[0] - w.from[0]), c = (s0 + s1) / 2;
    out.push({
      kind, rotY: th, size: [s1 - s0, y1 - y0, depth], exterior: w.exterior, ...(roof && { roof }),
      center: [w.from[0] + Math.cos(th) * c, at + (y0 + y1) / 2, -(w.from[1] + Math.sin(th) * c)],
    });
  };
  let floor = b.base ?? 0;
  b.levels.forEach((lv) => {
    out.push({ kind: 'slab', outline: lv.outline, y: floor - slab, thickness: slab });
    wallsOf(lv).forEach((w, wi) => {
      const holes = (lv.openings ?? []).filter((o) => o.wall === wi).sort((a, z) => a.at - z.at);
      let cursor = -t / 2;
      for (const o of holes) {
        const bottom = o.kind === 'door' || o.sill === undefined ? 0 : o.sill, top = bottom + o.height;
        box(w, floor, cursor, o.at, 0, lv.height);
        box(w, floor, o.at, o.at + o.width, 0, bottom); // below a window
        box(w, floor, o.at, o.at + o.width, top, lv.height); // above the opening
        if (bottom > 0) {
          const [a, z] = [o.at, o.at + o.width];
          box(w, floor, a, z, bottom, top, 'glass', 0.02);
          box(w, floor, a, a + F, bottom, top, 'frame', 0.08); // jambs
          box(w, floor, z - F, z, bottom, top, 'frame', 0.08);
          box(w, floor, a + F, z - F, bottom, bottom + F, 'frame', 0.08); // sill and head
          box(w, floor, a + F, z - F, top - F, top, 'frame', 0.08);
          if (o.width >= 1) box(w, floor, (a + z - F) / 2, (a + z + F) / 2, bottom + F, top - F, 'frame', 0.08); // centre mullion
        }
        cursor = o.at + o.width;
      }
      box(w, floor, cursor, w.length + t / 2, 0, lv.height);
    });
    floor += lv.height + slab;
  });
  const top = b.levels[b.levels.length - 1];
  out.push({ kind: 'slab', outline: top.outline, y: floor - slab, thickness: slab, roof: true }); // flat roof
  if (b.parapet) for (const w of wallsOf({ ...top, walls: [] })) { // round the roof edge, on top of the roof slab
    box(w, floor, -t / 2, w.length + t / 2, 0, b.parapet, 'wall', t, true);
    if (b.balustrade) box(w, floor, -t / 2, w.length + t / 2, b.parapet, b.parapet + b.balustrade, 'glass', 0.02, true);
  }
  return out;
}

/**
 * The ground as flat pieces at their levels: the main ground (a square `half` metres each way from the
 * building's middle) with holes for the building and for each site area, then each area. Never higher than
 * the bottom of the ground-floor slab, so the ground cannot flicker against a floor.
 */
export function grounds(b: Building, half: number) {
  const e = extents(b), t = b.wallThickness / 2, slab = b.slab ?? 0.2;
  const [main = { level: 0 }, ...areas] = b.site ?? [];
  const cx = (e.minX + e.maxX) / 2, cy = (e.minY + e.maxY) / 2;
  const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // ponytail: the building's hole is its bounding box, exact for rectangles; an L-shaped plan would leave bare ground in its corner
  const footprint = box(e.minX - t, e.minY - t, e.maxX + t, e.maxY + t);
  const y = (level: number) => Math.min(level, -slab);
  return [
    { y: y(main.level), outline: box(cx - half, cy - half, cx + half, cy + half), holes: [footprint, ...areas.map((a) => a.outline!)] },
    ...areas.map((a) => ({ y: y(a.level), outline: a.outline!, holes: [] as Point[][] })),
  ];
}

/** JSON with each point, wall and opening kept on one line, so a plan reads as a short list. */
export const pretty = (b: Building) => JSON.stringify(b, null, 2)
  .replace(/\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/g, '[$1, $2]')
  .replace(/\[\s*(\[[^[\]]*\]),\s*(\[[^[\]]*\])\s*\]/g, '[$1, $2]')
  .replace(/\{[^{}[\]]*\}/g, (m) => m.replace(/\s+/g, ' '));

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
