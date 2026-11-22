# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["ifcopenshell==0.9.0.post1", "numpy==2.5.5", "pytest==9.2.0"]
# ///
"""Checks tools/to_ifc.py on the app's three samples and on two harder buildings (mixed wall thickness, grids,
a basement below ground). Free, no network once uv has the packages. From the project folder:

    uv run --quiet tools/check_ifc.py [building.json ...]   # no files: the built-in five

Each file must pass IfcOpenShell's validator with the IFC2X3 rules (pytest runs them), and read back as 3D:
the outside size and height match the numbers, each storey's walls stand on its floor, each wall has its own
thickness in its type, every door and window sits inside its own hole, every slab outline is closed, and the
grid is written once, on the building, with every line named and in place.
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ue
import ifcopenshell.util.placement as up

import to_ifc

ROOT = Path(__file__).resolve().parent.parent
samples = json.loads(subprocess.run(['node', '--input-type=module', '-e', "import { SAMPLES } from './lib/building.ts'; console.log(JSON.stringify(SAMPLES))"],
                                    cwd=ROOT, capture_output=True, text=True, check=True).stdout)
bungalow, house = samples[1], samples[2]
mixed = {**bungalow, 'name': 'Bungalow, thin inside walls, grids',
         'levels': [{**bungalow['levels'][0], 'walls': [[[6, 0], [6, 8], 0.115], [[6, 4], [12, 4], 0.15]]}],
         'grids': [{'name': 'A', 'x': 0}, {'name': 'B', 'x': 6}, {'name': 'C', 'x': 12}, {'name': '1', 'y': 0}, {'name': '2', 'y': 8}]}
basement = {**house, 'name': 'House over a basement', 'base': -3.2, 'grids': [{'name': 'A', 'x': 0.5}, {'name': 'B', 'x': 8.5, 'y': None}, {'name': '1', 'y': 6.5}],
            'levels': [{**house['levels'][0], 'name': 'Basement'}] + house['levels']}

settings = ifcopenshell.geom.settings()
settings.set('use-world-coords', True)


def box(el):
    v = np.array(ifcopenshell.geom.create_shape(settings, el).geometry.verts).reshape(-1, 3)
    return v.min(0), v.max(0)


def check(b):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'b.ifc'
        to_ifc.build(b).write(str(path))
        rules = subprocess.run([sys.executable, '-m', 'ifcopenshell.validate', '--rules', str(path)], capture_output=True, text=True)
        assert '0 error(s) found' in rules.stdout + rules.stderr, rules.stdout + rules.stderr
        f = ifcopenshell.open(str(path))

    t0, slab, base = b['wallThickness'], b.get('slab', 0.2), b.get('base', 0)
    # outside size and height, from every wall and slab
    lo, hi = np.full(3, 1e9), np.full(3, -1e9)
    for el in f.by_type('IfcWallStandardCase') + f.by_type('IfcSlab'):
        a, z = box(el)
        lo, hi = np.minimum(lo, a), np.maximum(hi, z)
    pts = [p for lv in b['levels'] for p in lv['outline']]
    want = [max(p[0] for p in pts) - min(p[0] for p in pts) + t0, max(p[1] for p in pts) - min(p[1] for p in pts) + t0]
    assert np.allclose((hi - lo)[:2], want, atol=1e-6), (hi - lo, want)
    top = base + sum(lv['height'] for lv in b['levels']) + slab * len(b['levels'])
    assert abs(lo[2] - (base - slab)) < 1e-6 and abs(hi[2] - top) < 1e-6, (lo[2], hi[2], base - slab, top)

    # each storey's walls on its floor, each wall its own thickness
    floor, walls = base, 0
    for storey, lv in zip(f.by_type('IfcBuildingStorey'), b['levels']):
        assert storey.Name == lv['name'] and abs(storey.Elevation - floor) < 1e-9
        own = sorted((el for el in ue.get_decomposition(storey) if el.is_a('IfcWallStandardCase')), key=lambda el: int(el.Name.split()[-1]))  # wall N is the spec's wall N - 1
        thick = [t0] * len(lv['outline']) + [w[2] if len(w) > 2 else t0 for w in lv.get('walls') or []]
        assert len(own) == len(thick)
        for el, t in zip(own, thick):
            a, z = box(el)
            assert abs(a[2] - floor) < 1e-6 and abs(z[2] - floor - lv['height']) < 1e-6, (el.Name, a[2], z[2], floor)
            layers = ue.get_material(el)
            assert abs(layers.ForLayerSet.MaterialLayers[0].LayerThickness - t) < 1e-9 and abs(layers.OffsetFromReferenceLine + t / 2) < 1e-9, el.Name
            assert ue.get_type(el).Name == f'Wall {round(t * 1000)} mm'
        walls += len(own)
        floor += lv['height'] + slab

    # every door and window inside its own hole (by GlobalId: names repeat)
    fills = f.by_type('IfcDoor') + f.by_type('IfcWindow')
    assert len(fills) == sum(len(lv.get('openings') or []) for lv in b['levels'])
    for el in fills:
        (a0, a1), (h0, h1) = box(el), box(el.FillsVoids[0].RelatingOpeningElement)
        assert np.all(a0 >= h0 - 1e-6) and np.all(a1 <= h1 + 1e-6), el.GlobalId

    # every floor and roof outline closed: it ends where it starts, or Revit warns about each one
    for el in f.by_type('IfcSlab'):
        for item in el.Representation.Representations[0].Items:
            pts = item.SweptArea.OuterCurve.Points
            assert pts[0].Coordinates == pts[-1].Coordinates, el.Name

    # one grid, hung on the building (Revit runs it through every floor; one per storey made repeats named A),
    # each line at its x or y in world coordinates
    grids = b.get('grids') or []
    tags = []
    if any('x' in g for g in grids) and any('y' in g for g in grids):
        want = {g['name']: g for g in grids}
        tags = sorted(want)
        found = f.by_type('IfcGrid')
        assert len(found) == 1 and found[0].ContainedInStructure[0].RelatingStructure.is_a('IfcBuilding'), found
        m = up.get_local_placement(found[0].ObjectPlacement)
        axes = list(found[0].UAxes) + list(found[0].VAxes)
        assert sorted(a.AxisTag for a in axes) == tags, axes
        for a in axes:
            ends = [m @ np.array([*p.Coordinates[:2], 0, 1]) for p in a.AxisCurve.Points]
            g = want[a.AxisTag]
            axis = 0 if 'x' in g else 1
            assert all(abs(e[axis] - g['x' if axis == 0 else 'y']) < 1e-6 for e in ends), (a.AxisTag, ends)
    else:
        assert not f.by_type('IfcGridAxis')
    print(f"ok  {b['name']}: {len(b['levels'])} storey(s), {walls} walls in {len(f.by_type('IfcWallType'))} type(s), {len(fills)} doors and windows, {len(tags)} grid lines, "
          f"{(hi - lo)[0]:.2f} x {(hi - lo)[1]:.2f} m, {lo[2]:+.2f} to {hi[2]:+.2f} m")


for b in [json.load(open(p)) for p in sys.argv[1:]] or samples + [mixed, basement]:  # or the buildings named on the command line
    check(b)
