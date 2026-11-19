// pnpm exec vitest run lib/building.test.ts
// Measures the built pieces, not the spec: the 3D shell must come out exactly as the numbers say.
import { describe, expect, it } from 'vitest';
import { area, extents, grounds, pieces, pretty, problems, SAMPLES, type Piece, type Point } from './building';

type Box = Exclude<Piece, { kind: 'slab' }>;

/** World-space bounds of a set of boxes (rotated about y). */
function bounds(boxes: Box[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const [sx, sy, sz] = b.size.map((v) => v / 2);
    for (const [u, w] of [[sx, sz], [sx, -sz], [-sx, sz], [-sx, -sz]]) {
      // three.js rotation about y: x' = x cos + z sin, z' = -x sin + z cos
      const x = b.center[0] + u * Math.cos(b.rotY) + w * Math.sin(b.rotY);
      const z = b.center[2] - u * Math.sin(b.rotY) + w * Math.cos(b.rotY);
      lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x);
      lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
    }
    lo[1] = Math.min(lo[1], b.center[1] - sy); hi[1] = Math.max(hi[1], b.center[1] + sy);
  }
  return { lo, hi, size: hi.map((h, i) => h - lo[i]) };
}

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
const studio = SAMPLES[0];

describe('building from numbers', () => {
  it('builds the studio shell to its outside dimensions', () => {
    const walls = pieces(studio).filter((p): p is Box => p.kind === 'wall');
    const { lo, size } = bounds(walls);
    near(size[0], 6 + 0.2); // centreline 6 m plus half a wall each side
    near(size[2], 4 + 0.2);
    near(size[1], 2.7);
    near(lo[1], 0);
  });

  it('leaves the door hole exactly where and as big as the spec says', () => {
    // wall 0 runs along plan y = 0 (z = 0), from x = 0 to 6; the door is 0.9 wide at 1.0 m, 2.1 high
    const onWall0 = pieces(studio).filter((p): p is Box => p.kind === 'wall' && Math.abs(p.center[2]) < 1e-9);
    const lowSolids = onWall0.filter((b) => b.center[1] - b.size[1] / 2 < 1e-9); // pieces that reach the floor
    const spans = lowSolids.map((b) => [b.center[0] - b.size[0] / 2, b.center[0] + b.size[0] / 2]).sort((a, z) => a[0] - z[0]);
    near(spans[0][0], -0.1); // wall 0 starts half a wall thickness before its corner, so the corner is filled
    near(spans[0][1], 1); // solid wall ends where the door starts
    near(spans[1][0], 1.9); // and starts again 0.9 m later
    const lintel = onWall0.find((b) => Math.abs(b.center[0] - 1.45) < 1e-9)!;
    near(lintel.center[1] - lintel.size[1] / 2, 2.1);
  });

  it('puts a window on its sill with glass in the hole', () => {
    const glass = pieces(studio).filter((p): p is Box => p.kind === 'glass');
    expect(glass).toHaveLength(2);
    for (const g of glass) { near(g.center[1] - g.size[1] / 2, 0.9); near(g.size[1], 1.2); near(g.size[0], 1.8); }
  });

  it('fills every corner: each wall runs half a thickness past both of its corners', () => {
    // a corner gap would show as a wall whose plan length is less than its centreline length plus one thickness
    const walls = pieces(studio).filter((p): p is Box => p.kind === 'wall' && p.center[1] - p.size[1] / 2 < 1e-9 && p.size[1] > 2.6);
    const run = (z: number) => walls.filter((w) => Math.abs(w.center[2] - z) < 1e-9 && Math.abs(Math.sin(w.rotY)) < 1e-9)
      .flatMap((w) => [w.center[0] - w.size[0] / 2, w.center[0] + w.size[0] / 2]);
    near(Math.min(...run(-4)), -0.1); // wall 2 (top edge, running right to left) reaches past x = 0
    near(Math.max(...run(-4)), 6.1);
  });

  it('stacks levels with a slab between them', () => {
    const house = SAMPLES[2];
    const { size } = bounds(pieces(house).filter((p): p is Box => p.kind === 'wall'));
    near(size[1], 3 + 0.2 + 2.8);
  });

  it('reports the outside height up to the top of the roof', () => {
    for (const b of SAMPLES) {
      const roof = pieces(b).find((p) => p.kind === 'slab' && p.roof) as Extract<Piece, { kind: 'slab' }>;
      near(extents(b).height, roof.y + roof.thickness);
    }
    near(extents(studio).height, 2.9); // 2.7 m room plus a 0.2 m roof slab
  });

  it('puts basements below ground when the first level starts below it', () => {
    // three 2.6 m basements under a ground floor: base -8.4, so the ground floor sits at 0
    const lv = (name: string) => ({ ...studio.levels[0], name, height: 2.6, openings: [] });
    const b = { ...studio, slab: 0.2, base: -8.4, levels: ['B3', 'B2', 'B1', 'Ground'].map(lv) };
    const walls = pieces(b).filter((p): p is Box => p.kind === 'wall');
    const { lo, hi } = bounds(walls);
    near(lo[1], -8.4); // the lowest basement floor
    near(hi[1], 2.6); // the ground floor's ceiling
    const e = extents(b);
    near(e.height, 2.8); // above ground only: ground floor plus its roof slab
    near(e.below, 8.4);
  });

  it('frames every window: jambs, sill, head, and a centre mullion when it is a metre or wider', () => {
    const frames = pieces(studio).filter((p): p is Box => p.kind === 'frame');
    expect(frames).toHaveLength(2 * 5); // two 1.8 m windows, five pieces each
    for (const f of frames) { // every frame piece sits inside its window hole: from the sill (0.9) to the head (2.1)
      expect(f.center[1] - f.size[1] / 2).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(f.center[1] + f.size[1] / 2).toBeLessThanOrEqual(2.1 + 1e-9);
    }
  });

  it('marks outside walls, so the facade can look different from the rooms', () => {
    const bungalow = pieces(SAMPLES[1]).filter((p): p is Box => p.kind === 'wall');
    expect(bungalow.some((w) => w.exterior)).toBe(true);
    expect(bungalow.some((w) => !w.exterior)).toBe(true);
    const inner = bungalow.filter((w) => !w.exterior); // the bungalow's inside walls run along x = 6 and y = 4 only
    for (const w of inner) expect(Math.abs(w.center[0] - 6) < 1e-9 || Math.abs(w.center[2] + 4) < 1e-9).toBe(true);
  });

  it('puts a parapet round the roof with a glass balustrade on top, both lifted with the roof', () => {
    const b = { ...studio, parapet: 1.2, balustrade: 0.94 };
    const roofTop = extents(b).height; // 2.9
    const parapet = pieces(b).filter((p): p is Box => p.kind !== 'slab' && !!p.roof);
    const solid = parapet.filter((p) => p.kind === 'wall'), glass = parapet.filter((p) => p.kind === 'glass');
    expect(solid).toHaveLength(4);
    expect(glass).toHaveLength(4);
    near(bounds(solid).lo[1], roofTop);
    near(bounds(solid).hi[1], roofTop + 1.2);
    near(bounds(glass).hi[1], roofTop + 1.2 + 0.94);
    near(bounds(solid).size[0], 6.2); // parapet runs the full outside width
  });

  it('lays the ground at its site levels: a sunken yard cut out of the main ground, and no earth inside the building', () => {
    const yard: Point[] = [[-0.1, 4.1], [6.1, 4.1], [6.1, 9], [-0.1, 9]]; // behind the studio's rear face (y 4.1)
    const b = { ...studio, site: [{ level: -1.82 }, { level: -7, outline: yard }] };
    const [main, low] = grounds(b, 50);
    near(main.y, -1.82);
    expect(main.holes).toEqual([[[-0.1, -0.1], [6.1, -0.1], [6.1, 4.1], [-0.1, 4.1]], yard]); // the studio's outside faces, then the yard
    near(low.y, -7);
    expect(low.outline).toEqual(yard);
    const e = extents(b);
    near(e.height - e.ground, 2.9 + 1.82); // the readout measures from the main ground to the roof top
    near(grounds(studio, 50)[0].y, -0.2); // no site: the ground stays under the ground-floor slab, as before
    expect(problems({ ...b, site: [{ level: -1.82 }, { level: -7 }] })[0]).toMatch(/site area 2 needs an outline/);
  });

  it('formats a spec so it reads back as the same building', () => {
    const b = { ...SAMPLES[2], site: [{ level: -1.82 }, { level: -7, outline: [[0, 7], [9, 7], [9, 12], [0, 12]] as Point[] }] };
    for (const s of [...SAMPLES, b]) expect(JSON.parse(pretty(s))).toEqual(s);
    expect(pretty(SAMPLES[0]).split('\n').length).toBeGreaterThan(10); // one item per line, not one long line
  });

  it('places fittings on their floor, turned to face the way the spec says', () => {
    const lv = { ...studio.levels[0], fixtures: [
      { kind: 'chair', at: [3, 2] as Point, size: [0.5, 0.5] as [number, number], rot: 90 }, // faces +x, so its back is on the -x side
      { kind: 'stair', at: [1, 2] as Point, size: [1, 3] as [number, number], from: 0, to: 1.4 }, // rot 0: climbs towards -y
    ] };
    const b = { ...studio, levels: [lv, { ...lv, name: 'Upper' }] };
    const things = pieces(b).filter((p): p is Box => p.kind === 'thing');
    const lower = things.filter((t) => t.center[1] < 2.9), upper = things.filter((t) => t.center[1] > 2.9);
    expect(lower.length).toBe(upper.length); // the same fittings on both floors
    near(bounds(upper).lo[1], 2.9); // standing on the upper floor (2.7 room + 0.2 slab)
    const chair = lower.filter((t) => Math.abs(t.center[0] - 3) < 0.5 && Math.abs(t.center[2] + 2) < 0.5);
    const back = chair.reduce((a, z) => (a.center[1] + a.size[1] / 2 > z.center[1] + z.size[1] / 2 ? a : z)); // the tallest piece
    expect(back.center[0]).toBeLessThan(3);
    const steps = lower.filter((t) => Math.abs(t.center[0] - 1) < 0.6);
    const top = steps.reduce((a, z) => (a.center[1] + a.size[1] / 2 > z.center[1] + z.size[1] / 2 ? a : z));
    near(top.center[1] + top.size[1] / 2, 1.4); // the flight ends at its "to" height
    expect(-top.center[2]).toBeLessThan(2); // and its top step is at the -y end
    expect(problems({ ...b, levels: [{ ...lv, fixtures: [{ kind: 'spaceship', at: [1, 1], size: [1, 1] }] }] })[0]).toMatch(/unknown kind "spaceship"/);
  });

  it('measures floor area inside the centrelines', () => {
    near(area(studio.levels[0].outline), 24);
    near(area(SAMPLES[1].levels[0].outline), 96);
  });

  it('accepts the samples and explains a bad opening', () => {
    for (const s of SAMPLES) expect(problems(s)).toEqual([]);
    const bad = structuredClone(studio);
    bad.levels[0].openings![0].at = 5.5; // a 0.9 m door starting 5.5 m along a 6 m wall
    expect(problems(bad)[0]).toMatch(/runs past the end of wall 0, which is 6.00 m long/);
  });

  it('gives an inside wall its own thickness when the spec has one, and keeps the building\'s otherwise', () => {
    // only boxes running up the plan at x = 3: the window in wall 2 is centred on x = 3 too
    const lv = { ...studio.levels[0], walls: [[[3, 0], [3, 4], 0.1]] as [Point, Point, number][], openings: [{ wall: 4, at: 1, width: 0.8, height: 2.1, kind: 'door' as const }] };
    const inner = pieces({ ...studio, levels: [lv] }).filter((p): p is Box => p.kind === 'wall' && Math.abs(p.center[0] - 3) < 1e-9 && Math.abs(Math.cos(p.rotY)) < 1e-9);
    for (const w of inner) near(w.size[2], 0.1); // the inside wall is 0.1 thick, not the studio's 0.2
    const { lo, hi } = bounds(inner);
    near(-hi[2], -0.05); near(-lo[2], 4.05); // and runs half its own thickness past each end
    near(inner.find((w) => w.center[1] > 2.1)!.size[0], 0.8); // the door's hole is still cut, over 0.8 m
    const plain = pieces({ ...studio, levels: [{ ...lv, walls: [[[3, 0], [3, 4]]] }] }).filter((p): p is Box => p.kind === 'wall' && Math.abs(p.center[0] - 3) < 1e-9 && Math.abs(Math.cos(p.rotY)) < 1e-9);
    for (const w of plain) near(w.size[2], 0.2);
    expect(problems({ ...studio, levels: [lv] })).toEqual([]);
    expect(problems({ ...studio, levels: [{ ...lv, walls: [[[3, 0], [3, 4], -1]] }] })[0]).toMatch(/inside wall 1: the third number is its thickness/);
  });

  it('accepts grid lines with a name and one of x or y, and keeps them through formatting', () => {
    const b = { ...SAMPLES[1], grids: [{ name: 'A', x: 0 }, { name: 'B', x: 6 }, { name: '1', y: 0 }, { name: '2', y: 8 }],
      levels: [{ ...SAMPLES[1].levels[0], walls: [[[6, 0], [6, 8], 0.115], [[6, 4], [12, 4]]] as [Point, Point, number?][] }] };
    expect(problems(b)).toEqual([]);
    expect(JSON.parse(pretty(b))).toEqual(b);
    expect(pretty(b)).toContain('[[6, 0], [6, 8], 0.115]'); // a wall with its thickness stays on one line
    expect(problems({ ...b, grids: [{ name: 'C', x: 1, y: 2 }] })[0]).toMatch(/grid line 1: needs a name and exactly one of x or y/);
    expect(problems({ ...b, grids: [{ name: '', y: 2 }] })[0]).toMatch(/grid line 1/);
  });
});
