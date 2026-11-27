"""Walls from a CAD PDF's own lines, for tools/read_drawing.py (free: no Claude call).

A cut wall is drawn as two parallel dark lines its thickness apart. pair_walls finds those pairs; merge_into puts them
into Claude's reading of the floor: the walls Claude read get the drawing's exact position and thickness, and walls
Claude missed are added only when the plan draws furniture in a different line weight (judged on Claude's furniture).
Tested 24 Nov 2026 against Revit's own model of Autodesk's Snowdon Towers sample and the hand-checked AU floors:
thickness within 2.5 cm on 69 to 78% of wall length (was 22 to 41%); walls found up on the floor it was built on,
barely on the floor kept back; AU unchanged within 0.01 of its score. Frame as the reader's: metres,
x = (px - X0) / ppm, y = (Y0 - top) / ppm.

    python3 tools/pdf_walls.py      # self-check
"""
import math

MIN_T, MAX_T, MIN_OVER, ANG, GAP, MIN_W = 0.05, 0.45, 0.25, math.radians(1.5), 1.1, 0.3


def dark(c):
    if not isinstance(c, (tuple, list)) or not c or not all(isinstance(v, (int, float)) for v in c):
        return False
    return (1 - c[3]) * (1 - max(c[:3])) < 0.3 if len(c) == 4 else max(c) <= 0.3  # CMYK: little light left


def strokes(page, box, X0, Y0, ppm, min_w=0.0):
    """Straight pieces of dark stroked paths inside box, in metres, at least 2 cm long."""
    out = []
    M = lambda p: ((p[0] - X0) / ppm, (Y0 - p[1]) / ppm)
    for oid, o in enumerate(page.crop(box).objects.get('line', []) + page.crop(box).objects.get('curve', []) + page.crop(box).objects.get('rect', [])):
        if not o.get('stroke') or (o.get('linewidth') or 0) < min_w or not dark(o.get('stroking_color')):
            continue
        if o['object_type'] == 'rect':
            q = [(o['x0'], o['top']), (o['x1'], o['top']), (o['x1'], o['bottom']), (o['x0'], o['bottom'])]
            pieces = list(zip(q, q[1:] + q[:1]))
        else:
            pieces, cur, start = [], None, None
            for op in o.get('path') or []:
                if op[0] == 'm':
                    cur = start = op[1]
                elif op[0] == 'l':
                    pieces.append((cur, op[1])); cur = op[1]
                elif op[0] == 'c':
                    cur = op[-1]
                elif op[0] == 'h' and cur and start:
                    pieces.append((cur, start)); cur = start
        for a, b in pieces:
            a, b = M(a), M(b)
            if math.dist(a, b) >= 0.02:
                out.append((a, b, o.get('linewidth') or 0, oid))
    return out


def _line(a, b):
    """Direction angle in [0, pi), unit vector, normal offset and the along-line interval."""
    th = math.atan2(b[1] - a[1], b[0] - a[0]) % math.pi
    if th > math.pi - 2 * ANG:  # nearly level lines all get an angle near 0, not some near pi
        th -= math.pi
    u = (math.cos(th), math.sin(th)); n = (-u[1], u[0])
    s0, s1 = sorted((a[0] * u[0] + a[1] * u[1], b[0] * u[0] + b[1] * u[1]))
    return th, u, n, a[0] * n[0] + a[1] * n[1], s0, s1


def pair_walls(segs, min_len=0.4):
    """[(start, end, thickness)] from facing pairs of parallel lines MIN_T to MAX_T apart.
    A pair is dropped when another parallel line runs between its two lines over most of their overlap (so a wall face
    pairs with its own other face, not with a counter beyond it), or when a line pairs at the same spacing on both sides
    (stair treads, a ladder of lines)."""
    L = [(*_line(a, b), oid, w) for a, b, w, oid in segs if w >= MIN_W]  # hairlines: layer lines inside walls, patterns
    L = [l for l in L if l[5] - l[4] >= 0.1]
    bins = {}
    for i, l in enumerate(L):
        bins.setdefault(round(math.degrees(l[0])) % 180, []).append(i)
    cand = []
    for i, (th, u, n, r, s0, s1, oid, _) in enumerate(L):
        k = round(math.degrees(th)) % 180
        for j in bins.get(k, []) + bins.get((k + 1) % 180, []) + bins.get((k - 1) % 180, []):
            if j <= i:
                continue
            th2, u2, n2, r2, t0, t1, oid2, _ = L[j]
            if oid2 == oid or min(abs(th - th2), math.pi - abs(th - th2)) > ANG:  # two sides of one shape: a desk, a tag box
                continue
            # the other line's offset (from its middle) and interval, measured in this line's frame
            mid = ((t0 + t1) / 2) * u2[0] + n2[0] * r2, ((t0 + t1) / 2) * u2[1] + n2[1] * r2
            d = mid[0] * n[0] + mid[1] * n[1] - r
            if not MIN_T <= abs(d) <= MAX_T:
                continue
            p0 = (u2[0] * t0 + n2[0] * r2, u2[1] * t0 + n2[1] * r2); p1 = (u2[0] * t1 + n2[0] * r2, u2[1] * t1 + n2[1] * r2)
            q0, q1 = sorted((p0[0] * u[0] + p0[1] * u[1], p1[0] * u[0] + p1[1] * u[1]))
            lo, hi = max(s0, q0), min(s1, q1)
            if hi - lo >= MIN_OVER:
                cand.append((i, j, d, lo, hi))
    # a third parallel line between the pair, over at least half the overlap, means these two do not face each other
    keep = []
    for i, j, d, lo, hi in cand:
        th, u, n, r, s0, s1, _, _ = L[i]
        blocked = False
        for k in bins.get(round(math.degrees(th)) % 180, []) + bins.get((round(math.degrees(th)) + 1) % 180, []) + bins.get((round(math.degrees(th)) - 1) % 180, []):
            if k in (i, j):
                continue
            th3, u3, n3, r3, t0, t1, _, _ = L[k]
            if min(abs(th - th3), math.pi - abs(th - th3)) > ANG:
                continue
            mid = ((t0 + t1) / 2) * u3[0] + n3[0] * r3, ((t0 + t1) / 2) * u3[1] + n3[1] * r3
            e = mid[0] * n[0] + mid[1] * n[1] - r
            if not (0.01 < e / d < 0.99 and abs(e) > 0.01 and abs(d - e) > 0.01):
                continue
            p0 = (u3[0] * t0 + n3[0] * r3, u3[1] * t0 + n3[1] * r3); p1 = (u3[0] * t1 + n3[0] * r3, u3[1] * t1 + n3[1] * r3)
            q0, q1 = sorted((p0[0] * u[0] + p0[1] * u[1], p1[0] * u[0] + p1[1] * u[1]))
            if min(hi, q1) - max(lo, q0) >= 0.5 * (hi - lo):
                blocked = True; break
        if not blocked:
            keep.append((i, j, d, lo, hi))
    # ladders: a line with partners on both sides at the same spacing
    sides = {}
    for i, j, d, lo, hi in keep:
        sides.setdefault(i, []).append(d); sides.setdefault(j, []).append(-d)
    ladder = {i for i, ds in sides.items() if any(a >= 0.2 and b < 0 and abs(a + b) < 0.03 for a in ds for b in ds)}  # treads 0.2 m and up
    keep = [p for p in keep if p[0] not in ladder and p[1] not in ladder]
    # each pair's band: along [lo, hi], across [r + min(0, d), r + max(0, d)] in line i's frame; merge touching bands
    bands = []
    for i, j, d, lo, hi in keep:
        th, u, n, r, _, _, _, wi = L[i]
        bands.append([th, u, n, lo, hi, r + min(0, d), r + max(0, d), {round(wi, 2), round(L[j][7], 2)}])
    merged = True
    while merged:
        merged = False
        out = []
        for b in sorted(bands, key=lambda b: (round(b[0], 2), b[5], b[3])):
            for m in out:
                if min(abs(m[0] - b[0]), math.pi - abs(m[0] - b[0])) > ANG or (m[1][0] * b[1][0] + m[1][1] * b[1][1]) < 0:
                    continue
                # the same wall carried on: same middle and thickness, at most a door-wide break (1.1 m) along it.
                # Bands side by side stay separate walls (a wall and the chase beside it), not one thick one.
                if abs((b[5] + b[6]) - (m[5] + m[6])) / 2 <= 0.025 and abs((b[6] - b[5]) - (m[6] - m[5])) < 0.03 and b[3] <= m[4] + GAP and m[3] <= b[4] + GAP:
                    m[3], m[4], m[5], m[6] = min(m[3], b[3]), max(m[4], b[4]), min(m[5], b[5]), max(m[6], b[6])
                    m[7] = m[7] | b[7]
                    merged = True; break
            else:
                out.append(list(b))
        bands = out
    walls = []
    for th, u, n, lo, hi, a, z, wts in bands:
        if hi - lo < min_len or not MIN_T <= z - a <= MAX_T + 0.05:
            continue
        c = (a + z) / 2
        P = lambda s: (round(u[0] * s + n[0] * c, 3), round(u[1] * s + n[1] * c, 3))
        walls.append([list(P(lo)), list(P(hi)), round(z - a, 3), sorted(wts)])
    return walls


def seg_dist(p, a, b):
    ax, ay, bx, by = *a, *b
    L2 = (bx - ax) ** 2 + (by - ay) ** 2
    t = 0 if L2 == 0 else max(0, min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L2))
    return math.dist(p, (ax + t * (bx - ax), ay + t * (by - ay)))


def _samples(a, b, step=0.1):
    n = max(1, int(math.dist(a, b) / step))
    return [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]


def _cover(a, b, segs, near):
    s = _samples(a, b)
    return sum(any(seg_dist(p, *q) <= near for q in segs) for p in s) / len(s)


def wall_weights(segs, fixtures, share=0.1):
    """Line weights the plan keeps for walls: those making up under a tenth of the stroke length inside Claude's
    furniture. No furniture read, no weights: nothing is added."""
    if not fixtures:
        return set()
    def in_fix(p):
        for it in fixtures:
            (x, y), (w, d), a = it['at'], it['size'], math.radians(it.get('rot', 0))
            u = (p[0] - x) * math.cos(a) + (p[1] - y) * math.sin(a); v = -(p[0] - x) * math.sin(a) + (p[1] - y) * math.cos(a)
            if abs(u) <= w / 2 - 0.03 and abs(v) <= d / 2 - 0.03:
                return True
        return False
    F = {}
    for a, b, wt, _ in segs:
        if in_fix(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)):
            F[round(wt, 2)] = F.get(round(wt, 2), 0) + math.dist(a, b)
    total = sum(F.values())
    return {round(wt, 2) for a, b, wt, _ in segs} - {k for k, v in F.items() if v >= share * total} if total else set()


def merge_into(lv, vec, strokes_=None, near=0.2):
    """Claude's level with the PDF's walls: outline unchanged; inside walls = the PDF's walls not on the outline, plus
    Claude's inside walls the PDF's do not cover. Openings on the outline keep their place; openings on inside walls
    follow their wall, or move to the nearest new wall running the same way."""
    o = lv['outline']
    edges = [(o[i], o[(i + 1) % len(o)]) for i in range(len(o))]
    cand = [w for w in vec if _cover(w[0], w[1], edges, 0.15) < 0.6]  # Claude's own outside walls already stand there
    claude = [(w[0], w[1]) for w in lv.get('walls') or []]
    # PDF walls on Claude's walls only correct position and thickness: always taken. A PDF wall Claude did not read is
    # added only when its lines are of a weight this plan does not draw furniture in (judged on Claude's own furniture),
    # since some plans (AU) draw desks and cabinets in the same weight as walls, and they too come in parallel pairs.
    free = wall_weights(strokes_, lv.get('fixtures') or []) if strokes_ is not None else set()
    new = [w for w in cand if (claude and _cover(w[0], w[1], claude, near) >= 0.5) or set(w[3]) <= free]
    new = [w[:3] for w in new]
    segs = [(w[0], w[1]) for w in new]
    kept, index = [], {}
    for k, w in enumerate(lv.get('walls') or []):
        if not segs or _cover(w[0], w[1], segs, near) < 0.5:
            index[len(o) + k] = len(o) + len(new) + len(kept)
            kept.append(w)
    walls = [list(w) for w in new + kept]
    all_segs = edges + [(w[0], w[1]) for w in walls]
    old = edges + [(w[0], w[1]) for w in lv.get('walls') or []]
    ops, moved, lost = [], 0, 0
    for op in lv.get('openings') or []:
        if op['wall'] < len(o) or op['wall'] in index:
            ops.append({**op, 'wall': op['wall'] if op['wall'] < len(o) else index[op['wall']]}); continue
        (ax, ay), (bx, by) = old[op['wall']]
        Lw = math.hypot(bx - ax, by - ay) or 1
        t = (op['at'] + op['width'] / 2) / Lw
        c = (ax + (bx - ax) * t, ay + (by - ay) * t)
        th = math.atan2(by - ay, bx - ax) % math.pi
        best = None  # (gap beyond the wall's end, offset from its line, index): a door often sits in a gap of the drawn faces
        for k in range(len(o), len(all_segs)):
            (px, py), (qx, qy) = all_segs[k]
            L2 = math.hypot(qx - px, qy - py)
            th2 = math.atan2(qy - py, qx - px) % math.pi
            if L2 == 0 or min(abs(th - th2), math.pi - abs(th - th2)) > math.radians(20):
                continue
            s = ((c[0] - px) * (qx - px) + (c[1] - py) * (qy - py)) / L2
            off = abs((c[0] - px) * (qy - py) - (c[1] - py) * (qx - px)) / L2
            gap = max(0, -s, s - L2)
            if off <= 0.3 and gap <= op['width'] / 2 + 1.0 and (best is None or (gap, off) < best[:2]):
                best = (gap, off, k)
        if best is None:
            lost += 1; continue
        k = best[2]
        (px, py), (qx, qy) = all_segs[k]
        L2 = math.hypot(qx - px, qy - py); ux, uy = (qx - px) / L2, (qy - py) / L2
        s = (c[0] - px) * ux + (c[1] - py) * uy
        lo, hi = min(0, s - op['width'] / 2), max(L2, s + op['width'] / 2)
        if lo < 0 or hi > L2:  # stretch the wall over the opening
            w = walls[k - len(o)]
            w[0], w[1] = [round(px + ux * lo, 3), round(py + uy * lo, 3)], [round(px + ux * hi, 3), round(py + uy * hi, 3)]
            all_segs[k] = (w[0], w[1])
            for q in ops:  # openings already on this wall keep their place
                if q['wall'] == k:
                    q['at'] = round(q['at'] - lo, 3)
            s -= lo
        ops.append({**op, 'wall': k, 'at': round(s - op['width'] / 2, 3)}); moved += 1
    return {**lv, 'walls': walls, 'openings': ops}, {'pdf_walls': len(new), 'claude_walls_kept': len(kept), 'openings_moved': moved, 'openings_lost': lost}


if __name__ == '__main__':  # self-check on a made-up plan: 10 m square, one wall drawn, one desk, one wall Claude read
    sq = lambda x0, y0, x1, y1, w, oid: [((x0, y0), (x1, y1), w, oid)]
    segs = (sq(1, 5.0, 9, 5.0, 0.6, 1) + sq(1, 5.15, 9, 5.15, 0.6, 2)          # a wall Claude missed, 0.15 m, wall weight
            + sq(2.3, 2.85, 3.7, 2.85, 0.4, 3) + sq(2.3, 3.15, 3.7, 3.15, 0.4, 4)  # a desk's two long edges, furniture weight
            + sq(1, 7.0, 6, 7.0, 0.4, 5) + sq(1, 7.2, 6, 7.2, 0.4, 6))           # the wall Claude read, really 0.2 m at y 7.1
    walls = pair_walls(segs)
    assert any(abs(w[0][1] - 5.075) < 1e-6 and w[2] == 0.15 for w in walls), walls
    lv = {'outline': [[0, 0], [10, 0], [10, 10], [0, 10]], 'walls': [[[1, 7.05], [6, 7.05], 0.1]],
          'openings': [{'wall': 4, 'at': 1.0, 'width': 0.9, 'height': 2.1, 'kind': 'door'}],
          'fixtures': [{'kind': 'desk', 'at': [3, 3], 'size': [1.6, 0.5], 'rot': 0}]}
    out, n = merge_into(lv, walls, segs)
    assert n == {'pdf_walls': 2, 'claude_walls_kept': 0, 'openings_moved': 1, 'openings_lost': 0}, n
    assert sorted(w[2] for w in out['walls']) == [0.15, 0.2], out['walls']  # the desk is not a wall; Claude's 0.1 is now 0.2
    door = out['openings'][0]
    a, b, _ = out['walls'][door['wall'] - 4]
    assert abs(a[1] - 7.1) < 1e-6 and abs(a[0] + door['at'] - 2.0) < 1e-6, (out['walls'], door)  # door still starts at x 2
    assert merge_into(lv, walls, None)[1]['pdf_walls'] == 1  # without the stroke census: corrections only
    print('pdf_walls self-check passed')
