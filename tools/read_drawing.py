# /// script
# requires-python = ">=3.12"
# dependencies = ["anthropic==2.4.0", "pdfplumber==0.11.10", "pillow==12.3.0"]
# ///
"""Reads an architectural drawing set (a CAD PDF with a text layer) into a Model Shop building, with Claude.

    uv run tools/read_drawing.py <job dir>          # the job dir holds input.pdf; writes status.json, building.json, check-<n>.jpg

The steps: 1 sort the pages (Claude looks at every sheet), 2 find each floor (grid lines and scale
measured from the PDF's own text, never the written scale), 3 walls, doors and windows and 4 furniture (one Claude
reading each per floor), 5 stack the floors by their level marks, 6 draw every reading over its plan for checking.
After step 2 it waits for the go (go.json in the job dir: which floors to read), so nothing costly starts unseen.
Dev flags: --boxes <json> skips step 1 with known plan boxes; --only <names>; --stop-after sort|find; --yes; --cap <dollars>.
The API key comes from ANTHROPIC_API_KEY (the app passes it on from .env.local).
"""
import argparse, base64, faulthandler, io, json, math, os, re, signal, statistics, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODEL, PRICE_IN, PRICE_OUT = 'claude-opus-5-5', 4 / 1e6, 20 / 1e6  # dollars per token; thinking is billed as output
MAX_OUT, SIDE, PER_FLOOR = 32000, 2576, 0.50  # output cap per call; picture side (Claude's full resolution); $ per floor (measured 17 Nov: two floors, walls and furniture, $0.98 and $1.02)
KINDS = ['desk', 'table', 'chair', 'armchair', 'sofa', 'cabinet', 'counter', 'sink', 'fridge', 'wc', 'basin', 'planter', 'stair', 'landing']  # lib/building.ts SHAPES
LABEL = re.compile(r'[A-Z]{1,2}|\d{1,2}')  # grid bubble text
NUMBER = re.compile(r'\d{3,}|\d{1,3}(,\d{3})+|\d+\.\d+')  # a grid bay is 500 (cm), 5000 or 5,000 (mm) or 5.00 (m); lone digits are tags


faulthandler.enable()  # a crash inside PDFium (native code) still leaves a trace in the log
PDFIUM = threading.Lock()  # PDFium is not thread-safe: two floors rendering at once killed the reader outright (17 Nov)


class Stop(Exception):
    """A reason to stop, said in words the page can show."""


# ---------- progress, written for the app to poll ----------

class Job:
    def __init__(self, folder: Path, cap: float):
        self.dir, self.cap, self.lock = folder, cap, threading.Lock()
        self.s = {'stage': 'start', 'log': [], 'cost': 0.0, 'cap': cap, 'floors': [], 'done': False, 'error': None}
        self.reserved = 0.0

    def save(self):
        tmp = self.dir / 'status.tmp'
        tmp.write_text(json.dumps(self.s, indent=1))
        os.replace(tmp, self.dir / 'status.json')

    def log(self, msg: str, **changes):
        with self.lock:
            self.s['log'] = (self.s['log'] + [f"{time.strftime('%H:%M:%S')} {msg}"])[-40:]
            self.s.update(changes)
            self.save()
        print(msg, flush=True)

    def floor(self, i: int, **changes):
        with self.lock:
            self.s['floors'][i].update(changes)
            self.save()

    # spend control: every call books its worst case before it starts, so four floors at once cannot overshoot the cap
    def book(self, tokens_in: int) -> float:
        worst = tokens_in * PRICE_IN + MAX_OUT * PRICE_OUT
        with self.lock:
            if self.s['cost'] + self.reserved + worst > self.cap:
                raise Stop(f"the ${self.cap:.0f} cap for this drawing would be passed (spent ${self.s['cost']:.2f})")
            self.reserved += worst
        return worst

    def settle(self, worst: float, cost: float):
        with self.lock:
            self.reserved -= worst
            self.s['cost'] = round(self.s['cost'] + cost, 3)
            self.save()


# ---------- Claude ----------

def picture(im, quality=88) -> dict:
    buf = io.BytesIO()
    im.convert('RGB').save(buf, 'JPEG', quality=quality)
    return {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': base64.b64encode(buf.getvalue()).decode()}}


def parse(text: str):
    blocks = re.findall(r'```(?:json)?\s*(.*?)```', text, re.S)
    starts = [i for i in (text.find('{'), text.find('[')) if i >= 0]
    for s in blocks[-1:] + ([text[min(starts):]] if starts else []):
        try:
            return json.loads(s)
        except ValueError:
            pass
    raise ValueError('the answer was not valid JSON')


def ask(job: Job, client, content: list, check, tokens_in: int):
    """One Claude reading; one retry when the answer is unusable. Returns the checked JSON."""
    for attempt in (1, 2):
        worst = job.book(tokens_in)
        cost = 0.0
        try:
            with client.messages.stream(model=MODEL, max_tokens=MAX_OUT, output_config={'effort': 'high'},
                                        messages=[{'role': 'user', 'content': content}]) as s:
                m = s.get_final_message()
            cost = m.usage.input_tokens * PRICE_IN + m.usage.output_tokens * PRICE_OUT
        finally:
            job.settle(worst, cost)
        if m.stop_reason == 'refusal':
            raise Stop('Claude declined to read this page')
        try:
            if m.stop_reason == 'max_tokens':
                raise ValueError('the answer was cut off at the length limit')
            d = parse(''.join(b.text for b in m.content if b.type == 'text'))
            check(d)
            return d
        except (ValueError, KeyError, TypeError, IndexError) as e:
            if attempt == 2:
                raise Stop(f'two unusable answers ({e})')
            content = content + [{'type': 'text', 'text': f'Your previous answer could not be used: {e}. Reply again, with only the JSON.'}]


# ---------- step 1: sort the pages ----------

SORT = """These are pages of one architectural drawing set, each labelled with its page number. For every page, say what it is, and give every separate floor plan drawn on it.
Reply with only JSON:
{"project": "the building's name if written, else null",
 "pages": [{"page": 1, "kind": "cover | floor plans | elevations | sections | legend | schedule | details | site | other",
   "plans": [{"name": "the plan's title as written, e.g. First floor plan",
              "type": "floor | part | finishes | roof | ceiling | site | other",
              "level": "the floor level in metres as written on the drawing (e.g. +2.80 gives 2.8, -5.60 gives -5.6), or null if not written",
              "box": [left, top, right, bottom],
              "furniture": true}]}]}
box: fractions from 0 to 1 of the page width and height, enclosing the whole plan with its grid bubbles and dimension lines, but no other drawing and not the title block. plans is [] on pages without floor plans. type "floor" is ONLY the general arrangement plan of a whole storey (walls, doors, furniture of the full floor); an enlarged or partial plan (one apartment, room, stair, toilet, foyer, core) is "part"; a finishes, flooring or furniture-layout plan of a storey is "finishes"; a reflected ceiling plan is "ceiling". If a storey has several whole-storey plans, only one of them is "floor"."""


def sort_pages(job, client, pdf):
    pages, project = [], None
    for start in range(0, len(pdf.pages), 20):
        content = []
        for i in range(start, min(start + 20, len(pdf.pages))):
            p = pdf.pages[i]
            im = p.to_image(resolution=1200 * 72 / max(p.width, p.height)).original
            content += [{'type': 'text', 'text': f'Page {i + 1}:'}, picture(im, 75)]
        content.append({'type': 'text', 'text': SORT})
        job.log(f'Sorting pages {start + 1} to {min(start + 20, len(pdf.pages))} of {len(pdf.pages)}')
        d = ask(job, client, content, lambda d: d['pages'][0]['kind'], tokens_in=1600 * (len(content) // 2) + 1500)
        pages += d['pages']
        project = project or d.get('project')
    plans = []
    for pg in pages:
        p = pdf.pages[int(pg['page']) - 1]
        for pl in pg.get('plans') or []:
            if pl.get('type') != 'floor':
                continue
            l, t, r, b = pl['box']
            pad = 0.03
            box = [max(0, (l - pad) * p.width), max(0, (t - pad) * p.height), min(p.width, (r + pad) * p.width), min(p.height, (b + pad) * p.height)]
            lv = pl.get('level')
            plans.append({'page': int(pg['page']), 'name': pl['name'], 'level': float(lv) if isinstance(lv, (int, float)) or (isinstance(lv, str) and re.fullmatch(r'[+-]?\d+(\.\d+)?', lv)) else None,
                          'box': box, 'furniture': bool(pl.get('furniture'))})
    legends = [int(pg['page']) for pg in pages if pg.get('kind') in ('legend', 'schedule')]
    return project, plans, legends


# ---------- step 2: find each floor ----------

def centre(w):
    return (w['x0'] + w['x1']) / 2, (w['top'] + w['bottom']) / 2


def label_lines(words, box):
    """Grid lines from the bubble text: labels of one size in a row are vertical lines, in a column horizontal ones.
    When a neighbouring plan's bubbles fall inside the box, the set nearest this plan's other grid lines wins."""
    c = [w for w in words if LABEL.fullmatch(w['text']) and w['upright']]
    found = {}
    for axis, along, across, span in (('x', 0, 1, box[2] - box[0]), ('y', 1, 0, box[3] - box[1])):
        groups = []
        for w in sorted(c, key=lambda w: (-w['size'], centre(w)[across])):
            for g in groups:
                if abs(g[0]['size'] - w['size']) < 0.5 and abs(centre(g[0])[across] - centre(w)[across]) < 0.25 * w['size']:  # hand-placed bubbles wander a little
                    g.append(w); break
            else:
                groups.append([w])
        found[axis] = []
        for g in groups:
            lines = {}
            for w in g:
                lines.setdefault(w['text'], centre(w)[along])
            pos = sorted(lines.values())
            if len(pos) < 2 or min(b - a for a, b in zip(pos, pos[1:])) < 0.03 * span:
                continue  # one bubble, or a little table of letters
            found[axis].append(((round(g[0]['size']), len(lines)), centre(g[0])[across], lines))  # bubble text is the largest on a plan

    def pick(axis, other):  # biggest text, most lines, then nearest the span of the other axis's lines
        if not found[axis]:
            return {}
        lo, hi = (min(other.values()), max(other.values())) if other else (0, 0)
        gap = lambda at: max(lo - at, at - hi, 0) if other else 0
        return max(found[axis], key=lambda g: (g[0], -gap(g[1])))[2]
    gx = pick('x', {})
    gy = pick('y', gx)
    return pick('x', gy), gy


LEVEL = re.compile(r'[+\-±]\d{1,3}\.\d{2,3}')  # a level mark: +2.80, -5.60, ±0.00


def level_mark(words):
    marks = [w['text'] for w in words if LEVEL.fullmatch(w['text'])]
    if any(m.startswith('±') for m in marks):
        return 0.0
    return float(statistics.mode(marks)) if marks else None


def measure_scale(words, gx):
    """PDF points per metre, from the dimension numbers written centred between neighbouring vertical grid lines."""
    nums = [w for w in words if NUMBER.fullmatch(w['text']) and w['upright']]
    ratios = []
    xs = sorted(gx.values())
    for a, b in zip(xs, xs[1:]):
        gap = b - a
        for w in nums:
            if abs(centre(w)[0] - (a + b) / 2) <= max(4, 0.06 * gap):
                v = float(w['text'].replace(',', ''))
                if v > 0:
                    ratios.append((v / gap, v))
    if not ratios:
        raise Stop('no dimension written between the grid lines, so the scale cannot be measured')
    ratios.sort()
    groups = []
    for r in ratios:
        if groups and r[0] <= groups[-1][0][0] * 1.012:
            groups[-1].append(r)
        else:
            groups.append([r])
    for g in sorted(groups, key=len, reverse=True):  # the best-supported reading that gives a believable bay
        r = statistics.median(x[0] for x in g)
        bay = statistics.median(x[1] for x in g)
        for unit in (1000, 100, 1):  # mm, cm, m: the one that makes a grid bay 1.5 to 15 m
            if 1.5 <= bay / unit <= 15:
                return unit / r, len(g), {1000: 'mm', 100: 'cm', 1: 'm'}[unit]
    raise Stop('no dimension between the grid lines reads as a grid bay of 1.5 to 15 m')


def find_floor(pdf, plan):
    page = pdf.pages[plan['page'] - 1]
    box = plan['box']
    words = [w for w in page.extract_words(extra_attrs=['size', 'upright'])
             if w['x0'] >= box[0] and w['x1'] <= box[2] and w['top'] >= box[1] and w['bottom'] <= box[3]]
    if not words:
        raise Stop('this plan has no text layer (a scan, or text turned into shapes), so it cannot be measured yet')
    gx, gy = label_lines(words, box)
    if len(gx) < 2 or len(gy) < 2:
        raise Stop(f'grid bubbles not found in the text ({len(gx)} across, {len(gy)} down)')
    try:
        ppm, votes, unit = measure_scale(words, gx)
    except Stop as e:  # the grid is there; the scale may still come from the other floors of the set
        ppm, votes, unit = None, 0, str(e)
    mark = level_mark(words)
    level = mark if mark is not None else plan['level']
    return {**plan, 'level': level, 'level_from': 'mark' if mark is not None else ('Claude' if level is not None else None),
            'gx': gx, 'gy': gy, 'ppm': ppm, 'votes': votes, 'unit': unit, 'words': words}


def common_origin(floors):
    """The grid lines every floor shares, leftmost and lowest, so the floors stack on the same spot."""
    def pick(key, lowest):
        shared = set.intersection(*(set(f[key]) for f in floors))
        if not shared:
            return None
        ref = floors[0][key]
        return (max if lowest else min)(shared, key=lambda k: ref[k])
    return pick('gx', False), pick('gy', True)


# ---------- steps 3 and 4: read each floor ----------

def render(pdf, f):
    page = pdf.pages[f['page'] - 1]
    x0, t0, x1, t1 = f['box']
    dpi = min(200, SIDE * 72 / max(x1 - x0, t1 - t0))
    with PDFIUM:
        im = page.crop(f['box']).to_image(resolution=dpi).original.convert('RGB')
    k = dpi / 72
    f['px'] = lambda xm, ym: ((f['X0'] + xm * f['ppm'] - x0) * k, (f['Y0'] - ym * f['ppm'] - t0) * k)
    f['k'] = k
    return im


def frame_text(f, im):
    k, ppx = f['k'], f['ppm'] * f['k']
    x0, t0 = f['box'][0], f['box'][1]
    vx = ', '.join(f"{l} at x {(x - x0) * k:.0f} px ({(x - f['X0']) / f['ppm']:.2f} m)" for l, x in sorted(f['gx'].items(), key=lambda i: i[1]))
    hy = ', '.join(f"{l} at y {(y - t0) * k:.0f} px ({(f['Y0'] - y) / f['ppm']:.2f} m)" for l, y in sorted(f['gy'].items(), key=lambda i: i[1]))
    return f"""The picture: {f['name']} (floor level {f['level']:+.2f} m), {im.width} by {im.height} px, rendered from the CAD drawing.

Known facts (measured from the drawing's own text; use them):
- Scale in this picture: {ppx:.2f} px per metre. Dimensions on the drawing are in {f['unit']}.
- Structural grid lines (the dash-dot lines through the lettered and numbered bubbles). Vertical: {vx}. Horizontal: {hy}. Trust the drawn line if it differs by a few px.
- Coordinate frame (metres): x = 0 on grid line {f['LX']}, increasing to the right; y = 0 on grid line {f['LY']}, increasing UP the picture. So x = (px - {(f['X0'] - x0) * k:.0f}) / {ppx:.2f} and y = ({(f['Y0'] - t0) * k:.0f} - py) / {ppx:.2f}."""


WALLS = """
What to produce (JSON, metres):
- wallThickness: the usual outside wall thickness, read from the drawing.
- outline: the exterior wall CENTRELINES of the main enclosed block, placed so the OUTER face is where the drawing has it (centreline = outer face moved inward by half the wall thickness). The outer face of a window wall is the outer edge of the columns, not the window line. A closed loop is implied.
- walls: every interior wall and partition drawn as a wall, including stair and lift shaft walls and toilet and office partitions. Not furniture, desks, cubicle screens or cupboards.
- openings: every door (kind "door", height 2.1, no sill) and every window or glazed panel in the outside walls, on all sides (kind "window"; sill 0.9 and height 1.5 unless the drawing gives them). Use the written figures and the door and window tags for widths and positions where they exist; scale from the picture otherwise.
- Leave out the escape stair outside the building, balconies, ramps, canopies and anything else outside the main block.

Types:
type Point = [number, number];
type Opening = { wall: number; at: number; width: number; height: number; sill?: number; kind?: 'door' | 'window' };
// wall: index; outline edges first (edge i runs outline[i] -> outline[i+1]; the last edge closes back to outline[0]), then interior walls in listed order
// at: distance from that wall's START point to the near edge of the opening, along the centreline
Rules: every opening has at >= 0 and at + width <= its wall's centreline length; at least 3 outline corners. A guess presented as a reading is worse than a gap.

Reply with only the JSON in one ```json block: {"wallThickness": number, "outline": Point[], "walls": [Point, Point][], "openings": Opening[]}"""

FITTINGS = """
The furniture and fittings: every piece drawn on this plan, as a JSON array of items:
  { "kind": K, "at": [x, y], "size": [w, d], "rot": degrees, "tag": "the drawing's tag or null" }
- at: the item's centre in plan. size: w along the item's own width, d its own depth, in metres, measured from the drawn symbol. rot: counter-clockwise turn in plan, in degrees. At rot 0 the item's FRONT faces DOWN the picture (-y): the side a person sits or stands at. So a chair whose sitter looks up the picture has rot 180; a desk worked from its right-hand side (+x) has rot 90.
- kind is one of: desk, chair, cabinet, table, sofa, armchair, wc, basin, sink, counter, fridge, planter, stair, landing.
- An L-shaped desk is TWO desk items (its two arms), each with the same tag.
- Leave out small things on desks and walls (computers, phones, lamps, bins, copiers, grab bars, driers, dispensers, mirrors). Include kitchen counters, sinks, fridges, toilets and basins, and the main stair.
- The main stair: each flight as kind "stair", size [flight width, flight run length], rot so that going UP means moving in the item's own -y direction turned by rot (rot 0: you climb down the picture), plus "from": height of its bottom above this floor and "to": height of its top. Each landing as kind "landing" with "h": its height above this floor. Floor to floor here is FLOOR_TO_FLOOR m.
- Furniture drawn without a tag still counts if it is clearly drawn. If the plan shows no furniture at all, reply [].

Reply with only the JSON array in one ```json block."""


def tags(f):
    out = []
    for w in f['words']:
        t = w['text']
        if re.fullmatch(r'[A-Z]{1,5}', t) and t not in f['gx'] and t not in f['gy']:
            x, y = centre(w)
            out.append(f"- {t} at ({(x - f['X0']) / f['ppm']:.2f}, {(f['Y0'] - y) / f['ppm']:.2f})")
    return out[:400]


def walls_of(lv):
    o = lv['outline']
    return [(o[i], o[(i + 1) % len(o)]) for i in range(len(o))] + [tuple(w[:2]) for w in lv.get('walls') or []]  # a third number is the wall's thickness


def grid_lines(floors, shared):
    """The grid in the building's frame (metres; x = 0 on line LX, y = 0 on line LY), for Revit users who set out from it.
    Floors on one origin and one scale pool their lines, the median per name; otherwise the first floor's grid alone."""
    xs, ys = {}, {}
    for f in floors if shared else floors[:1]:
        for name, x in f['gx'].items():
            xs.setdefault(name, []).append((x - f['X0']) / f['ppm'])
        for name, y in f['gy'].items():
            ys.setdefault(name, []).append((f['Y0'] - y) / f['ppm'])
    line = lambda axis, d: [{'name': n, axis: round(v, 3)} for n, v in sorted(((n, statistics.median(v)) for n, v in d.items()), key=lambda i: i[1])]
    return line('x', xs) + line('y', ys)


def num(v):
    return isinstance(v, (int, float)) and math.isfinite(v)


def clean_walls(d, note):
    pt = lambda p: isinstance(p, list) and len(p) == 2 and all(num(v) for v in p)
    outline = [p for p in d['outline'] if pt(p)]
    if len(outline) < 3:
        raise ValueError('the outline needs at least 3 corners')
    lv = {'outline': outline, 'walls': [w for w in d.get('walls') or [] if isinstance(w, list) and len(w) == 2 and pt(w[0]) and pt(w[1])], 'openings': []}
    segs = walls_of(lv)
    dropped = 0
    for op in d.get('openings') or []:
        try:
            (ax, ay), (bx, by) = segs[op['wall']]
            L = math.hypot(bx - ax, by - ay)
            if op['at'] < -0.01 or op['at'] + op['width'] > L + 0.01 or op['width'] <= 0:
                raise ValueError
            o = {'wall': op['wall'], 'at': max(0, op['at']), 'width': min(op['width'], L - max(0, op['at'])), 'height': op.get('height', 2.1)}
            if op.get('kind') == 'window':
                o.update(kind='window', sill=op.get('sill', 0.9))
                o['height'] = min(o['height'], 2.6 - o['sill'])
            else:
                o['kind'] = 'door'
            lv['openings'].append(o)
        except (ValueError, TypeError, IndexError, KeyError):
            dropped += 1
    if dropped:
        note(f'{dropped} opening(s) did not fit their wall and were left out')
    t = d.get('wallThickness')
    return lv, t if num(t) and 0.08 <= t <= 0.6 else None


def clean_fittings(items, note):
    out, dropped = [], 0
    for it in items if isinstance(items, list) else []:
        try:
            if it['kind'] not in KINDS or not (len(it['at']) == 2 and all(num(v) for v in it['at'])) or not all(num(v) and v > 0 for v in it['size']):
                raise ValueError
            f = {'kind': it['kind'], 'at': it['at'], 'size': it['size'][:2], 'rot': it.get('rot') if num(it.get('rot')) else 0}
            for k in ('from', 'to', 'h'):
                if num(it.get(k)):
                    f[k] = it[k]
            out.append(f)
        except (KeyError, TypeError, ValueError):
            dropped += 1
    if dropped:
        note(f'{dropped} item(s) of an unknown kind or shape were left out')
    return out


def read_floor(job, client, pdf, i, f, legend):
    note = lambda m: job.log(f"{f['name']}: {m}")
    im = render(pdf, f)
    frame = frame_text(f, im)
    job.floor(i, state='walls')
    head = 'You are reading one floor plan of a building into an exact 3D building spec. Work from the picture.\n\n' + frame
    d = ask(job, client, [picture(im), {'type': 'text', 'text': head + '\n' + WALLS}], lambda d: clean_walls(d, lambda m: None), 11000)
    lv, thick = clean_walls(d, note)
    job.floor(i, state='furniture')
    t = tags(f)
    brief = ('You are adding the furniture and fittings to one floor plan of a building, whose walls, doors and windows are already read. Work from the picture.\n\n' + frame
             + ('\n\nEvery short capital-letter tag in the drawing\'s text layer inside this plan, at its position in metres (the tag sits on or next to its symbol; '
                'some are room or door labels, not furniture):\n' + '\n'.join(t) if t else '')
             + (f'\n\nText of the drawing set\'s legend or schedule pages (tag meanings):\n{legend}' if legend else '')
             + '\n\nThe walls already read (do not change them; use them to place things):\n```json\n' + json.dumps(lv) + '\n```\n'
             + FITTINGS.replace('FLOOR_TO_FLOOR', f"{f.get('storey', 3.0):.2f}"))
    items = ask(job, client, [picture(im), {'type': 'text', 'text': brief}], lambda d: d if isinstance(d, list) else d['items'], 16000)
    lv['fixtures'] = clean_fittings(items if isinstance(items, list) else items['items'], note)
    check(f, im, lv, job.dir / f"check-{i}.jpg")
    job.floor(i, state='done', note=f"{len(lv['walls'])} inside walls, {sum(o['kind'] == 'door' for o in lv['openings'])} doors, "
                                    f"{sum(o['kind'] == 'window' for o in lv['openings'])} windows, {len(lv['fixtures'])} fittings")
    return lv, thick


# ---------- step 6: draw the reading over the plan ----------

def check(f, im, lv, path):
    from PIL import Image, ImageDraw
    im = Image.blend(im, Image.new('RGB', im.size, 'white'), 0.45)
    d = ImageDraw.Draw(im)
    P = f['px']
    for a, b in walls_of(lv):
        d.line([P(*a), P(*b)], fill=(40, 90, 220), width=5)
    for o in lv['openings']:
        (ax, ay), (bx, by) = walls_of(lv)[o['wall']]
        L = math.hypot(bx - ax, by - ay) or 1
        s, e = o['at'] / L, (o['at'] + o['width']) / L
        d.line([P(ax + (bx - ax) * s, ay + (by - ay) * s), P(ax + (bx - ax) * e, ay + (by - ay) * e)],
               fill=(230, 120, 20) if o['kind'] == 'door' else (200, 30, 200), width=9)
    for it in lv.get('fixtures', []):
        (x, y), (w, dp), a = it['at'], it['size'], math.radians(it.get('rot', 0))
        R = lambda u, v: P(x + u * math.cos(a) - v * math.sin(a), y + u * math.sin(a) + v * math.cos(a))
        d.polygon([R(-w / 2, -dp / 2), R(w / 2, -dp / 2), R(w / 2, dp / 2), R(-w / 2, dp / 2)], outline=(220, 30, 30), width=3)
        d.line([R(0, -dp / 2), R(0, -dp / 2 - 0.15)], fill=(220, 30, 30), width=3)
    im.thumbnail((1600, 1600))
    im.save(path, quality=82)


# ---------- the whole run ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('job', type=Path)
    ap.add_argument('--boxes', type=Path, help='known plans: JSON list of {page, name, level, box: [x0, top, x1, bottom] in PDF points}')
    ap.add_argument('--only', help='comma-separated plan names to read')
    ap.add_argument('--stop-after', choices=['sort', 'find'])
    ap.add_argument('--yes', action='store_true', help='read every floor found without waiting for go.json')
    ap.add_argument('--cap', type=float, default=15.0)
    a = ap.parse_args()
    job = Job(a.job.resolve(), a.cap)

    def cancelled(*_):  # no lock here: the main thread may hold it; the atomic replace keeps the file whole
        job.s.update(error='Cancelled.', done=True)
        job.save()
        os._exit(1)
    signal.signal(signal.SIGTERM, cancelled)
    try:
        run(job, a)
    except Stop as e:
        job.log(f'Stopped: {e}', error=str(e)[0].upper() + str(e)[1:] + '.', done=True)
    except Exception as e:  # anything unexpected still ends the run visibly
        job.log(f'Failed: {type(e).__name__}: {e}', error=f'Something went wrong: {type(e).__name__}: {e}', done=True)
        raise
    finally:
        if not job.s['done']:
            job.log('Stopped', done=True)


def run(job, a):
    import pdfplumber
    pdf = pdfplumber.open(job.dir / 'input.pdf')
    client = None
    if not a.boxes or not a.stop_after:
        import anthropic
        if not os.environ.get('ANTHROPIC_API_KEY'):
            raise Stop('no ANTHROPIC_API_KEY: add it to .env.local and restart the app')
        client = anthropic.Anthropic(max_retries=5)  # a new key's rate limits: four floors at once may hit them

    # 1. sort the pages
    if a.boxes:
        project, plans, legends = None, json.loads(a.boxes.read_text()), []
    else:
        job.log(f'Step 1: sorting {len(pdf.pages)} pages', stage='sort')
        project, plans, legends = sort_pages(job, client, pdf)
    job.log(f"Found {len(plans)} floor plan(s): {', '.join(p['name'] for p in plans) or 'none'}")
    if not plans:
        raise Stop('no floor plans found in this drawing')
    if a.stop_after == 'sort':
        job.s['plans'] = [{k: p[k] for k in ('page', 'name', 'level', 'box')} for p in plans]
        job.log('Stopped after step 1', done=True)
        return

    # 2. find each floor
    job.log('Step 2: finding the grid and scale of each floor', stage='find')
    floors = []
    for p in plans:
        try:
            floors.append(find_floor(pdf, p))
            f = floors[-1]
            job.log(f"{p['name']}: grid {'-'.join(sorted(f['gx'], key=f['gx'].get))} by {'-'.join(sorted(f['gy'], key=f['gy'].get))}, "
                    + (f"{f['ppm']:.2f} pt per metre from {f['votes']} dimension(s) in {f['unit']}" if f['ppm'] else f"scale not measured here: {f['unit']}"))
        except Stop as e:
            job.log(f"{p['name']}: left out, {e}")
            job.s.setdefault('left_out', []).append({'name': p['name'], 'why': str(e)})
    measured = [f for f in floors if f['ppm']]
    if not measured:
        raise Stop('no floor could be measured: ' + (floors[0]['unit'] if floors else 'no grid found'))
    pooled = statistics.median(g['ppm'] for g in measured)
    for f in floors:  # a set's plans share one scale: pool the floors' readings, keep a clearly different one, fill a missing one
        if not f['ppm']:
            f['ppm'], f['unit'] = pooled, measured[0]['unit']
            job.log(f"{f['name']}: using the scale measured on the other floors ({pooled:.2f} pt per metre)")
        elif abs(f['ppm'] / pooled - 1) < 0.03:
            f['ppm'] = pooled
    agree = sum(abs(f['ppm'] / pooled - 1) < 0.03 for f in measured)
    if agree * 2 <= len(measured) and len(measured) > 1:  # most floors disagree: the numbers matched were not grid dimensions
        lo, hi = min(f['ppm'] for f in measured), max(f['ppm'] for f in measured)
        job.s['warning'] = (f'The scale could not be measured reliably: the floors give {lo:.0f} to {hi:.0f} pt per metre. '
                            'This drawing set writes its grid dimensions in a way the reader does not follow yet, so sizes would likely be wrong.')
        job.log(job.s['warning'])
        for f in floors:
            f.setdefault('notes', []).append('scale uncertain')
    lx, ly = common_origin(floors)
    if lx is None or ly is None:
        job.log('The floors share no grid line, so each floor is placed on its own grid and they may not line up')
    for f in floors:
        f['LX'] = lx if lx in f['gx'] else min(f['gx'], key=f['gx'].get)
        f['LY'] = ly if ly in f['gy'] else max(f['gy'], key=f['gy'].get)
        f['X0'], f['Y0'] = f['gx'][f['LX']], f['gy'][f['LY']]
    # levels: the written marks; a floor without one is placed between its neighbours in sheet order (a guess, said so)
    known = [(j, f['level']) for j, f in enumerate(floors) if f['level'] is not None]
    diffs = [(v1 - v0) / (j1 - j0) for (j0, v0), (j1, v1) in zip(known, known[1:])]
    step = statistics.median(diffs) if diffs else 3.0
    for j, f in enumerate(floors):
        if f['level'] is None:
            before = [k for k in known if k[0] < j]
            after = [k for k in known if k[0] > j]
            if before and after:
                (j0, v0), (j1, v1) = before[-1], after[0]
                f['level'] = v0 + (v1 - v0) * (j - j0) / (j1 - j0)
            elif before or after:
                j0, v0 = (before[-1] if before else after[0])
                f['level'] = v0 + step * (j - j0)
            else:
                f['level'] = step * j
            f['level'] = round(f['level'], 2)
            job.log(f"{f['name']}: no level mark found, placed at {f['level']:+.2f} m between its neighbours (a guess)")
            f.setdefault('notes', []).append('level guessed')
    floors.sort(key=lambda f: f['level'])
    steps = [b['level'] - a_['level'] for a_, b in zip(floors, floors[1:]) if b['level'] > a_['level']]
    for j, f in enumerate(floors):
        f['storey'] = floors[j + 1]['level'] - f['level'] if j + 1 < len(floors) and floors[j + 1]['level'] > f['level'] else (statistics.median(steps) if steps else 3.0)
    for j, f in enumerate(floors):
        same = [g['name'] for g in floors[:j] if abs(g['level'] - f['level']) < 0.05]
        if same:  # another plan of a storey already listed
            f.setdefault('notes', []).append(f'same level as {same[0]}')
        if not f['votes'] and 'scale uncertain' not in f.get('notes', []):
            f.setdefault('notes', []).append('scale taken from the other floors')
    job.s['floors'] = [{'name': f['name'], 'level': f['level'], 'page': f['page'], 'state': 'waiting', 'note': ', '.join(f.get('notes', [])),
                        'pick': not any(n == 'scale uncertain' or n.startswith('same level') for n in f.get('notes', []))} for f in floors]
    job.s['estimate'] = round(len(floors) * PER_FLOOR, 2)
    job.s['project'] = project
    job.save()
    if a.stop_after == 'find':
        job.s['found'] = [{k: f[k] for k in ('name', 'page', 'level', 'box', 'ppm', 'votes', 'unit', 'gx', 'gy', 'LX', 'LY')} for f in floors]
        job.log('Stopped after step 2', done=True)
        return

    # the go: which floors to read
    if not a.yes:
        job.log(f"Ready: {len(floors)} floor(s), about ${job.s['estimate']:.2f} to read them all. Waiting for the go.", stage='confirm')
        go = job.dir / 'go.json'
        for _ in range(1800):
            if go.exists():
                break
            time.sleep(1)
        else:
            raise Stop('no go within 30 minutes')
        pick = set(json.loads(go.read_text()).get('floors', []))
    else:
        pick = {j for j, f in enumerate(floors) if not a.only or f['name'] in a.only.split(',')}
    for j, f in enumerate(job.s['floors']):
        if j not in pick:
            f['state'] = 'skipped'
    chosen = [j for j in range(len(floors)) if j in pick]
    if not chosen:
        raise Stop('no floors chosen')

    # 3 and 4. read the chosen floors, four at a time
    legend = ''
    for n in legends[:3]:
        legend += (pdf.pages[n - 1].extract_text() or '')[:3000] + '\n'
    job.log(f"Step 3 and 4: reading {len(chosen)} floor(s)", stage='read')
    results = {}

    def one(j):
        try:
            results[j] = read_floor(job, client, pdf, j, floors[j], legend.strip())
        except Exception as e:  # a failed floor keeps its place in the stack; the others carry on
            msg = str(e) if isinstance(e, Stop) else f'{type(e).__name__}: {e}'
            job.floor(j, state='failed', note=msg)
            job.log(f"{floors[j]['name']}: failed, {msg}")

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, chosen))
    if not results:
        raise Stop('no floor could be read')

    # 5. stack: one level per chosen floor, in level order; a failed floor keeps its place with the outline below or above it
    slab = 0.2
    thick = statistics.median([t for _, t in results.values() if t] or [0.2])
    levels = []
    for j in chosen:
        f = floors[j]
        if j in results:
            lv = results[j][0]
        else:
            near = min(results, key=lambda k: abs(k - j))
            lv = {'outline': results[near][0]['outline'], 'walls': [], 'openings': [], 'fixtures': []}
            f['name'] += ' (not read)'
        h = round(max(2.0, f['storey'] - slab), 2)
        lv['openings'] = [{**o, 'height': round(min(o['height'], h - o.get('sill', 0)), 3)} for o in lv['openings'] if h - o.get('sill', 0) > 0.3]
        levels.append({'name': f['name'], 'height': h, **lv})
    building = {'name': project or 'Building from a drawing', 'wallThickness': round(thick, 2), 'slab': slab, 'levels': levels,
                'grids': grid_lines([floors[j] for j in chosen], lx is not None and ly is not None and not job.s.get('warning'))}
    if floors[chosen[0]]['level'] < 0:
        building['base'] = floors[chosen[0]]['level']
    (job.dir / 'building.json').write_text(json.dumps(building))
    job.log(f"Done: {len(results)} of {len(chosen)} floor(s) read, ${job.s['cost']:.2f} spent", stage='done', done=True)


if __name__ == '__main__':
    main()
