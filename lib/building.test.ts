// pnpm exec vitest run lib/building.test.ts
// Measures the built pieces, not the spec: the 3D shell must come out exactly as the numbers say.
import { describe, expect, it } from 'vitest';
import { area, extents, pieces, problems, SAMPLES, type Piece } from './building';

type Box = Extract<Piece, { kind: 'wall' | 'glass' }>;

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
});
