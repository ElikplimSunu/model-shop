# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["ifcopenshell==0.9.0.post1", "numpy==2.5.5"]
# ///
"""A Model Shop building (the numbers of lib/building.ts, as JSON) to an IFC2X3 file that Revit can link or open.

    uv run --quiet tools/to_ifc.py building.json building.ifc

Keeps what a Revit user builds on: storeys at their floor levels, walls along their centrelines with their
thickness (one wall type per thickness), doors and windows filling holes in their walls, floor slabs, the flat
roof, and the grid lines. IFC2X3, because Revit opens it as well as links it.
ponytail: leaves out furniture, stairs, the parapet, the site and colours; add them when a Revit user needs them.
"""
import json
import math
import sys

import numpy as np
import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.util.element

for _m in ('project', 'owner', 'root', 'unit', 'context', 'aggregate', 'geometry', 'material', 'spatial', 'type', 'pset', 'feature', 'grid'):
    __import__(f'ifcopenshell.api.{_m}')
import ifcopenshell.api.owner.settings as owner_settings


def place(x, y, z, th=0.0):
    """4x4 placement: origin at (x, y, z), local x turned th radians from plan x. Plan x and y are IFC x and y; z is up."""
    m = np.eye(4)
    m[:2, :2] = [[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]
    m[:3, 3] = [x, y, z]
    return m


def build(b):
    t0, slab = b['wallThickness'], b.get('slab', 0.2)
    f = api.project.create_file(version='IFC2X3')
    # IFC2X3 wants an owner on every element: a generic one, no personal details
    person = api.owner.add_person(f, identification='ModelShop', family_name='Model Shop', given_name='')
    org = api.owner.add_organisation(f, identification='ModelShop', name='Model Shop')
    user = api.owner.add_person_and_organisation(f, person=person, organisation=org)
    app = api.owner.add_application(f, application_developer=org, version='0.1', application_full_name='Model Shop', application_identifier='ModelShop')
    owner_settings.get_user = lambda _f: user
    owner_settings.get_application = lambda _f: app

    project = api.root.create_entity(f, 'IfcProject', name=b.get('name') or 'Model Shop building')
    api.unit.assign_unit(f, units=[api.unit.add_si_unit(f, unit_type=u) for u in ('LENGTHUNIT', 'AREAUNIT', 'VOLUMEUNIT')])  # metres
    model = api.context.add_context(f, context_type='Model')
    body = api.context.add_context(f, context_type='Model', context_identifier='Body', target_view='MODEL_VIEW', parent=model)
    axis = api.context.add_context(f, context_type='Model', context_identifier='Axis', target_view='GRAPH_VIEW', parent=model)
    site = api.root.create_entity(f, 'IfcSite', name='Site')
    building = api.root.create_entity(f, 'IfcBuilding', name=b.get('name') or 'Building')
    api.aggregate.assign_object(f, products=[site], relating_object=project)
    api.aggregate.assign_object(f, products=[building], relating_object=site)
    for p in (site, building):
        api.geometry.edit_object_placement(f, product=p)

    # a wall type per thickness, like Revit's wall types: the thickness lives in its material layer
    masonry = api.material.add_material(f, name='Masonry')
    types = {}

    def wall_type(t):
        if t not in types:
            name = f'Wall {round(t * 1000)} mm'
            layers = api.material.add_material_set(f, name=name, set_type='IfcMaterialLayerSet')
            api.material.edit_layer(f, layer=api.material.add_layer(f, layer_set=layers, material=masonry), attributes={'LayerThickness': t})
            types[t] = api.root.create_entity(f, 'IfcWallType', name=name, predefined_type='STANDARD')
            api.material.assign_material(f, products=[types[t]], type='IfcMaterialLayerSet', material=layers)
        return types[t]

    def pset(el, name, props):
        api.pset.edit_pset(f, pset=api.pset.add_pset(f, product=el, name=name), properties=props)

    floor = b.get('base', 0)
    storeys = []
    for li, lv in enumerate(b['levels']):
        storey = api.root.create_entity(f, 'IfcBuildingStorey', name=lv['name'])
        storey.Elevation = floor
        api.aggregate.assign_object(f, products=[storey], relating_object=building)
        api.geometry.edit_object_placement(f, product=storey, matrix=place(0, 0, floor))
        storeys.append(storey)
        H = lv['height']

        def add(cls, name, rep, matrix, predefined=None):
            el = api.root.create_entity(f, cls, name=name, predefined_type=predefined)
            api.spatial.assign_container(f, products=[el], relating_structure=storey)
            api.geometry.edit_object_placement(f, product=el, matrix=matrix)
            api.geometry.assign_representation(f, product=el, representation=rep)
            return el

        outline = [tuple(p[:2]) for p in lv['outline']]
        add('IfcSlab', f'{lv["name"]} floor', api.geometry.add_slab_representation(f, context=body, depth=slab, polyline=outline), place(0, 0, floor - slab), 'FLOOR')

        n = len(outline)
        walls = [(outline[i], outline[(i + 1) % n], True, t0) for i in range(n)]
        walls += [(tuple(w[0]), tuple(w[1]), False, w[2] if len(w) > 2 else t0) for w in lv.get('walls') or []]
        made = []
        for wi, (a, z, ext, t) in enumerate(walls):
            L, th = math.dist(a, z), math.atan2(z[1] - a[1], z[0] - a[0])
            w = api.root.create_entity(f, 'IfcWallStandardCase', name=f'{"Exterior" if ext else "Interior"} wall {wi + 1}')
            api.spatial.assign_container(f, products=[w], relating_structure=storey)
            api.type.assign_type(f, related_objects=[w], relating_type=wall_type(t))
            ifcopenshell.util.element.get_material(w).OffsetFromReferenceLine = -t / 2  # the layer centred on the axis, like the body
            api.geometry.edit_object_placement(f, product=w, matrix=place(a[0], a[1], floor, th))
            # Revit draws a wall along a line: the axis is the centreline, corner to corner, and the body is centred on it
            api.geometry.assign_representation(f, product=w, representation=api.geometry.add_axis_representation(f, context=axis, axis=((0.0, 0.0), (L, 0.0))))
            api.geometry.assign_representation(f, product=w, representation=api.geometry.add_wall_representation(f, context=body, length=L, height=H, offset=-t / 2, thickness=t))
            pset(w, 'Pset_WallCommon', {'IsExternal': ext})
            made.append((w, th, a, ext, t))

        for oi, o in enumerate(lv.get('openings') or []):
            w, th, a, ext, t = made[o['wall']]
            door = o.get('kind') == 'door' or 'sill' not in o
            sill = 0 if door else o['sill']
            frame = place(a[0], a[1], floor, th)
            # the hole: a box through the whole wall, a little thicker so it cuts cleanly
            hole = api.root.create_entity(f, 'IfcOpeningElement', name=f'Opening {oi + 1}')
            api.geometry.edit_object_placement(f, product=hole, matrix=frame @ place(o['at'], 0, sill))
            api.geometry.assign_representation(f, product=hole, representation=api.geometry.add_wall_representation(
                f, context=body, length=o['width'], height=o['height'], offset=-t / 2 - 0.05, thickness=t + 0.1))
            api.feature.add_feature(f, feature=hole, element=w)
            # the door or window that fills it, so it stays tied to its wall
            size = f'{round(o["width"] * 1000)} x {round(o["height"] * 1000)}'
            if door:
                rep = api.geometry.add_door_representation(f, context=body, overall_height=o['height'], overall_width=o['width'], operation_type='SINGLE_SWING_LEFT',
                                                         lining_properties={'LiningDepth': t, 'LiningOffset': 0.0, 'CasingDepth': 0.0, 'CasingThickness': 0.0,
                                                                            'LiningToPanelOffsetY': (t - 0.035) / 2, 'ThresholdDepth': t})  # frame the full wall depth, no trim sticking out
                el = add('IfcDoor', f'Door {size}', rep, frame @ place(o['at'], -t / 2, sill))
            else:
                rep = api.geometry.add_window_representation(f, context=body, overall_height=o['height'], overall_width=o['width'], partition_type='SINGLE_PANEL')
                el = add('IfcWindow', f'Window {size}', rep, frame @ place(o['at'], -t / 2, sill))
            el.OverallWidth, el.OverallHeight = o['width'], o['height']
            api.feature.add_filling(f, opening=hole, element=el).OwnerHistory = project.OwnerHistory  # the API leaves this link without one; IFC2X3 needs it
            pset(el, 'Pset_DoorCommon' if door else 'Pset_WindowCommon', {'IsExternal': ext})

        floor += H + slab
        if li == len(b['levels']) - 1:  # the flat roof on the top level, as in the app
            add('IfcSlab', 'Roof', api.geometry.add_slab_representation(f, context=body, depth=slab, polyline=outline), place(0, 0, floor - slab), 'ROOF')

    # grid lines, on the lowest storey, running 2 m past the building each way
    grids = b.get('grids') or []
    num = lambda v: isinstance(v, (int, float)) and math.isfinite(v)  # problems() lets a null stand for the unused one
    across, up = [g for g in grids if num(g.get('y'))], [g for g in grids if num(g.get('x'))]
    if across and up:  # IFC2X3 needs lines both ways
        pts = [p for lv in b['levels'] for p in lv['outline']] + [(g['x'], 0) for g in up] + [(0, g['y']) for g in across]
        x0, x1 = min(p[0] for p in pts) - 2, max(p[0] for p in pts) + 2
        y0, y1 = min(p[1] for p in pts) - 2, max(p[1] for p in pts) + 2
        z = storeys[0].Elevation
        grid = api.root.create_entity(f, 'IfcGrid', name='Grid')
        api.spatial.assign_container(f, products=[grid], relating_structure=storeys[0])
        api.geometry.edit_object_placement(f, product=grid, matrix=place(0, 0, z))
        for g in across:
            api.grid.create_axis_curve(f, p1=np.array((x0, g['y'], z)), p2=np.array((x1, g['y'], z)), grid_axis=api.grid.create_grid_axis(f, grid=grid, axis_tag=g['name'], uvw_axes='UAxes'))
        for g in up:
            api.grid.create_axis_curve(f, p1=np.array((g['x'], y0, z)), p2=np.array((g['x'], y1, z)), grid_axis=api.grid.create_grid_axis(f, grid=grid, axis_tag=g['name'], uvw_axes='VAxes'))
    elif grids:
        print('grid lines run only one way, so they were left out (IFC2X3 needs both)', file=sys.stderr)

    # the usual IFC2X3 exchange view, rather than the library's IFC4 default
    f.header.file_description.description = ('ViewDefinition [CoordinationView_V2.0]',)
    return f


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    f = build(json.load(open(src)))
    f.header.file_name.name = out.split('/')[-1]
    f.write(out)
    print(out, {c: len(f.by_type(c)) for c in ('IfcBuildingStorey', 'IfcWallStandardCase', 'IfcWallType', 'IfcDoor', 'IfcWindow', 'IfcSlab', 'IfcGridAxis')})
