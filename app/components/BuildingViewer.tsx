'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls } from '@react-three/drei';
import { ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Studio, useDark } from './ModelViewer';
import { extents, pieces, wallsOf, type Building, type Piece } from '@/lib/building';

type Controls = ComponentRef<typeof OrbitControls>;

function Slab({ p, mat }: { p: Extract<Piece, { kind: 'slab' }>; mat: THREE.Material }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(p.outline.map(([x, y]) => new THREE.Vector2(x, y)));
    return new THREE.ExtrudeGeometry(shape, { depth: p.thickness, bevelEnabled: false });
  }, [p.outline, p.thickness]);
  useEffect(() => () => geo.dispose(), [geo]);
  // the shape is drawn in plan (x, y); turning it -90 degrees about x puts plan y on -z and extrudes upward
  return <mesh geometry={geo} material={mat} position={[0, p.y, 0]} rotation={[-Math.PI / 2, 0, 0]} />;
}

/** Frames the whole building once per size, and saves that view for Reset. */
function Fit({ b }: { b: Building }) {
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);
  const e = extents(b);
  const key = `${e.width.toFixed(1)}|${e.depth.toFixed(1)}|${e.height.toFixed(1)}|${size.width}x${size.height}`;
  useEffect(() => {
    const { camera, controls } = get(); // OrbitControls registers itself as the default (makeDefault)
    const cam = camera as THREE.PerspectiveCamera, c = controls as Controls | null;

    const center = new THREE.Vector3((e.minX + e.maxX) / 2, e.height / 2, -(e.minY + e.maxY) / 2);
    const radius = new THREE.Vector3(e.width, e.height, e.depth).length() / 2;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
    cam.position.copy(center).add(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(dist));
    cam.near = dist / 100; cam.far = dist * 20; cam.updateProjectionMatrix();
    cam.lookAt(center);
    if (c) { c.target.copy(center); c.update(); c.saveState(); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- refit only when the size changes, not on every edit
  return null;
}

export default function BuildingViewer({ b }: { b: Building }) {
  const dark = useDark();
  const controls = useRef<Controls>(null);
  const group = useRef<THREE.Group>(null);
  const [roof, setRoof] = useState(true);
  const [upTo, setUpTo] = useState(b.levels.length);
  const shownLevels = Math.min(upTo, b.levels.length);
  const shown = useMemo(() => ({ ...b, levels: b.levels.slice(0, shownLevels) }), [b, shownLevels]);
  const parts = useMemo(() => pieces(shown).filter((p) => roof || !(p.kind === 'slab' && p.roof)), [shown, roof]);
  const mats = useMemo(() => ({
    wall: new THREE.MeshStandardMaterial({ color: '#e8e3d8', roughness: 0.85 }),
    slab: new THREE.MeshStandardMaterial({ color: '#b9b2a4', roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: '#8fb3c4', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45 }),
  }), []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const e = extents(b);

  // dimension labels on the ground-floor exterior walls, pushed 0.8 m outside the wall
  const ground = b.levels[0];
  const ccw = ground.outline.reduce((s, [x, y], i) => { const [x2, y2] = ground.outline[(i + 1) % ground.outline.length]; return s + x * y2 - x2 * y; }, 0) > 0;
  const labels = wallsOf(ground).filter((w) => w.exterior).map((w) => {
    const [dx, dy] = [(w.to[0] - w.from[0]) / w.length, (w.to[1] - w.from[1]) / w.length];
    const [nx, ny] = ccw ? [dy, -dx] : [-dy, dx];
    const mx = (w.from[0] + w.to[0]) / 2 + nx * 0.8, my = (w.from[1] + w.to[1]) / 2 + ny * 0.8;
    return { pos: [mx, 0.02, -my] as [number, number, number], text: `${w.length.toFixed(2)} m` };
  });

  const download = () => {
    if (!group.current) return;
    new GLTFExporter().parse(group.current, (out) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' }));
      a.download = `${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'building'}.glb`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, () => {}, { binary: true });
  };

  return (
    <section className="view" aria-label="3D view of the building">
      <Canvas dpr={[1, 2]} camera={{ fov: 35, position: [20, 15, 20] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}>
        <Studio />
        <directionalLight position={[8, 14, 5]} intensity={0.9} />
        <Grid infiniteGrid cellSize={1} sectionSize={5} cellThickness={0.6} sectionThickness={1}
          cellColor={dark ? '#2f302b' : '#c9c2b2'} sectionColor={dark ? '#4a4a42' : '#a49c89'}
          fadeDistance={90} fadeStrength={1.5} position={[0, -0.21, 0]} />
        <group ref={group} name={b.name}>
          {parts.map((p, i) => p.kind === 'slab'
            ? <Slab key={i} p={p} mat={mats.slab} />
            : <mesh key={i} material={p.kind === 'glass' ? mats.glass : mats.wall} position={p.center} rotation={[0, p.rotY, 0]}>
                <boxGeometry args={p.size} />
              </mesh>)}
        </group>
        {labels.map((l, i) => (
          <Html key={i} position={l.pos} center zIndexRange={[10, 0]}><span className="dim-label mono">{l.text}</span></Html>
        ))}
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2 - 0.02} />
        <Fit b={b} />{/* after the controls: its effect needs them registered (effects run in tree order) */}
      </Canvas>

      <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
      <p className="tag mono"><b>02</b> View · true scale, metres</p>

      <div className="readout num">
        <span className="dims"><span>W</span>{e.width.toFixed(2)} <span>D</span>{e.depth.toFixed(2)} <span>H</span>{e.height.toFixed(2)} <span>m, outside</span></span>
        <span>grid: 1 m squares, heavier line every 5 m</span>
      </div>
      <div className="tools">
        <button type="button" onClick={() => controls.current?.reset()}>Reset view</button>
        <button type="button" aria-pressed={!roof} onClick={() => setRoof(!roof)}>Lift roof</button>
        {b.levels.length > 1 && (
          <button type="button" aria-pressed={shownLevels < b.levels.length} onClick={() => setUpTo(shownLevels > 1 ? shownLevels - 1 : b.levels.length)}>
            {shownLevels < b.levels.length ? `Floors 1 to ${shownLevels}` : 'All floors'}
          </button>
        )}
        <button type="button" onClick={download}>Download .glb</button>
      </div>
    </section>
  );
}
