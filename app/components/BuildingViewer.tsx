'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls } from '@react-three/drei';
import { ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Studio, useDark } from './ModelViewer';
import { extents, grounds, pieces, wallsOf, type Building, type Piece } from '@/lib/building';

type Controls = ComponentRef<typeof OrbitControls>;

function Slab({ p, mat }: { p: Extract<Piece, { kind: 'slab' }>; mat: THREE.Material }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(p.outline.map(([x, y]) => new THREE.Vector2(x, y)));
    return new THREE.ExtrudeGeometry(shape, { depth: p.thickness, bevelEnabled: false });
  }, [p.outline, p.thickness]);
  useEffect(() => () => geo.dispose(), [geo]);
  // the shape is drawn in plan (x, y); turning it -90 degrees about x puts plan y on -z and extrudes upward
  return <mesh geometry={geo} material={mat} position={[0, p.y, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow />;
}

/** One piece of ground: catches shadows, and when floors lie below ground, shows the earth see-through over them. */
function Ground({ g, earth, dark }: { g: ReturnType<typeof grounds>[number]; earth: boolean; dark: boolean }) {
  const geo = useMemo(() => {
    const v = (pts: [number, number][]) => pts.map(([x, y]) => new THREE.Vector2(x, y));
    const shape = new THREE.Shape(v(g.outline));
    shape.holes = g.holes.map((h) => new THREE.Path(v(h)));
    return new THREE.ShapeGeometry(shape);
  }, [g]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group position={[0, g.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>{/* plan y onto -z, like the slabs */}
      <mesh geometry={geo} receiveShadow renderOrder={2}><shadowMaterial opacity={dark ? 0.35 : 0.18} /></mesh>
      {earth && ( /* drawn first and writing no depth, so the grid and shadows still show on it */
        <mesh geometry={geo} position={[0, 0, -0.015]} renderOrder={-1}>
          <meshBasicMaterial color={dark ? '#1f201c' : '#e6e1d4'} transparent opacity={dark ? 0.82 : 0.72} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** Shadow area for a building: big enough to hold it and its shadow, small enough to keep the shadow sharp. */
const sunFor = (e: ReturnType<typeof extents>) => ({ reach: Math.max(e.width, e.depth, e.height + e.below) * 1.2 });

/** Late-afternoon sun from the south-west, casting shadows across the whole building. */
function Sun({ e }: { e: ReturnType<typeof extents> }) {
  const { reach } = sunFor(e);
  const target = useMemo(() => new THREE.Object3D(), []);
  const c: [number, number, number] = [(e.minX + e.maxX) / 2, (e.height - e.below) / 2, -(e.minY + e.maxY) / 2];
  return (
    <>
      <primitive object={target} position={c} />{/* in the scene, so the light keeps aiming at the building */}
      <directionalLight target={target} position={[c[0] - reach * 0.6, c[1] + reach * 1.1, c[2] + reach * 0.8]} intensity={1.6} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-reach} shadow-camera-right={reach} shadow-camera-top={reach} shadow-camera-bottom={-reach}
        shadow-camera-near={0.1} shadow-camera-far={reach * 4} />
    </>
  );
}

const CREW = ['var(--red)', '#3b82c4', '#3a9a6a', '#d08a1e', '#8a5cc4']; // the How it works sheet's cursor red, plus four
const BUILD = 3; // seconds to put up a building, whatever its size

/**
 * A new building goes up piece by piece while five cursors build it together, like the cursor crew on the
 * How it works sheet (that library moves between page elements, so it cannot follow 3D pieces). Each cursor
 * owns a slice of the plan, cut by angle round the middle, and puts up its own pieces floor by floor, so the
 * crew spreads round the building instead of chasing one point. They fly in from outside and leave when done.
 * Runs once per building, not on every edit, and not at all for people who ask for reduced motion.
 */
function Crew({ run, name, children }: { run: string; name: string; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const crew = useRef<(THREE.Group | null)[]>([]);
  const look = useRef<(HTMLDivElement | null)[]>([]); // drei's Html ignores a hidden parent, so the cursors fade by style
  const state = useRef({ run: '', t: 0, done: true, jobs: [] as { obj: THREE.Object3D; at: THREE.Vector3 }[][], home: [] as THREE.Vector3[], built: [] as number[] });
  useFrame((_, dt) => {
    const g = group.current, s = state.current;
    if (!g) return;
    if (s.run !== run) { // a new building: hide it all, share it out, and start
      s.run = run; s.t = 0;
      s.done = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!s.done && g.children.length) {
        const at = g.children.map((c) => c.getWorldPosition(new THREE.Vector3()));
        const box = new THREE.Box3().setFromPoints(at), mid = box.getCenter(new THREE.Vector3());
        const r = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 3, slice = (2 * Math.PI) / CREW.length;
        s.jobs = CREW.map(() => []); s.built = CREW.map(() => 0);
        g.children.forEach((c, i) => { // pieces keep their building order (floor by floor) inside each slice
          c.visible = false;
          s.jobs[Math.floor((Math.atan2(at[i].z - mid.z, at[i].x - mid.x) + Math.PI) / slice) % CREW.length].push({ obj: c, at: at[i] });
        });
        s.home = CREW.map((_, k) => { const a = (k + 0.5) * slice - Math.PI; return new THREE.Vector3(mid.x + Math.cos(a) * r, box.min.y, mid.z + Math.sin(a) * r); });
        crew.current.forEach((c, k) => { if (c) { c.position.copy(s.home[k]); c.userData.to = s.home[k]; } });
        look.current.forEach((d) => { if (d) d.style.opacity = '1'; });
      } else s.done = true;
    }
    if (s.done) { look.current.forEach((d) => { if (d && d.style.opacity !== '0') d.style.opacity = '0'; }); return; }
    s.t += dt;
    const f = Math.min(1, s.t / BUILD);
    s.jobs.forEach((job, k) => { // every cursor works through its own slice at the same pace
      const next = Math.ceil(job.length * f), c = crew.current[k];
      for (let i = s.built[k]; i < next; i++) job[i].obj.visible = true;
      if (c && next > s.built[k]) c.userData.to = job[next - 1].at;
      s.built[k] = next;
    });
    if (f >= 1) { // all up: each cursor heads back out the way it came, fading as it goes
      crew.current.forEach((c, k) => { if (c) c.userData.to = s.home[k]; });
      if (s.t > BUILD + 0.3) look.current.forEach((d) => { if (d) d.style.opacity = '0'; });
      if (s.t > BUILD + 0.8) s.done = true;
    }
    crew.current.forEach((c) => { if (c?.userData.to) c.position.lerp(c.userData.to, Math.min(1, dt * 7)); });
  });
  return <>
    <group ref={group} name={name}>{children}</group>
    {CREW.map((color, i) => (
    <group key={i} ref={(el) => { crew.current[i] = el; }}>
      <Html zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div ref={(el) => { look.current[i] = el; }} style={{ opacity: 0, transition: 'opacity .4s ease' }}><svg width="22" height="22" viewBox="0 0 24 24" style={{ display: 'block', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.35))' }}>
          <path d="M3 2l7.6 19.2 2.7-8 7.9-2.8z" fill={color} stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
        </svg></div>
      </Html>
    </group>
    ))}
  </>;
}

/** Frames the whole building once per size, and saves that view for Reset. */
function Fit({ b }: { b: Building }) {
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);
  const e = extents(b);
  const key = `${e.width.toFixed(1)}|${e.depth.toFixed(1)}|${e.height.toFixed(1)}|${e.below.toFixed(1)}|${size.width}x${size.height}`;
  useEffect(() => {
    const { camera, controls } = get(); // OrbitControls registers itself as the default (makeDefault)
    const cam = camera as THREE.PerspectiveCamera, c = controls as Controls | null;

    const center = new THREE.Vector3((e.minX + e.maxX) / 2, (e.height - e.below) / 2, -(e.minY + e.maxY) / 2);
    const radius = new THREE.Vector3(e.width, e.height + e.below, e.depth).length() / 2;
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
  const scene = useRef<THREE.Scene>(null);
  const [roof, setRoof] = useState(true);
  const [hidden, setHidden] = useState(0); // top floors hidden; counting from the top keeps every floor shown when a taller building is pasted
  const shownLevels = Math.max(1, b.levels.length - hidden);
  const shown = useMemo(() => ({ ...b, levels: b.levels.slice(0, shownLevels) }), [b, shownLevels]);
  const parts = useMemo(() => pieces(shown).filter((p) => roof || !p.roof), [shown, roof]);
  // a default look (light render outside, white inside, tinted glass, dark aluminium frames), with the building's own colours where its drawings name them
  const colors = JSON.stringify(b.colors ?? {});
  const mats = useMemo(() => {
    const c = JSON.parse(colors) as NonNullable<Building['colors']>;
    const std = (color: string, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      outside: std(c.outside ?? '#d6d1c7', 0.9),
      inside: std(c.inside ?? '#f1eee8', 0.85),
      slab: std('#a8a39a', 0.9),
      glass: new THREE.MeshStandardMaterial({ color: c.glass ?? '#4f6b7d', roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.6, envMapIntensity: 1.4 }),
      frame: std(c.frame ?? '#3b3f44', 0.45, 0.6),
      // ponytail: fittings share six fixed materials; per-item colours when a drawing gives them
      wood: std('#b08a5e', 0.7), fabric: std('#3f444c', 0.95), porcelain: std('#f7f6f2', 0.25), steel: std('#b7bcc2', 0.35, 0.7),
      stone: std('#cfcac0', 0.8), plant: std('#4d7a45', 0.9),
    };
  }, [colors]);
  const matOf = (p: Exclude<Piece, { kind: 'slab' }>) => p.kind === 'thing' ? mats[p.mat ?? 'wood'] : p.kind === 'glass' ? mats.glass : p.kind === 'frame' ? mats.frame : p.exterior ? mats.outside : mats.inside;
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const e = extents(b);
  const sun = sunFor(e);
  const land = useMemo(() => grounds(b, sun.reach * 2), [b, sun.reach]);
  const low = Math.min(...land.map((g) => g.y));
  const under = e.ground - (b.base ?? 0); // how far the lowest floor is below the main ground

  // dimension labels on the ground-floor exterior walls, pushed 0.8 m outside the wall
  const ground = b.levels[0];
  const ccw = ground.outline.reduce((s, [x, y], i) => { const [x2, y2] = ground.outline[(i + 1) % ground.outline.length]; return s + x * y2 - x2 * y; }, 0) > 0;
  const labels = wallsOf(ground).filter((w) => w.exterior).map((w) => {
    const [dx, dy] = [(w.to[0] - w.from[0]) / w.length, (w.to[1] - w.from[1]) / w.length];
    const [nx, ny] = ccw ? [dy, -dx] : [-dy, dx];
    const mx = (w.from[0] + w.to[0]) / 2 + nx * 0.8, my = (w.from[1] + w.to[1]) / 2 + ny * 0.8;
    return { pos: [mx, (b.base ?? 0) + 0.02, -my] as [number, number, number], text: `${w.length.toFixed(2)} m` };
  });

  const download = () => {
    const building = scene.current?.getObjectByName(b.name);
    if (!building) return;
    new GLTFExporter().parse(building, (out) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' }));
      a.download = `${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'building'}.glb`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, () => {}, { binary: true });
  };

  return (
    <section className="view" aria-label="3D view of the building">
      <Canvas dpr={[1, 2]} shadows camera={{ fov: 35, position: [20, 15, 20] }}
        onCreated={({ gl, scene: sc }) => { gl.toneMapping = THREE.NeutralToneMapping; scene.current = sc; }}>
        <Studio />
        <Sun key={sun.reach} e={e} />{/* new light per size: three sets a directional shadow's area only when its shadow map is first made */}
        {land.map((g, i) => <Ground key={i} g={g} earth={under > 0} dark={dark} />)}
        <Grid infiniteGrid cellSize={1} sectionSize={5} cellThickness={0.6} sectionThickness={1}
          cellColor={dark ? '#2f302b' : '#c9c2b2'} sectionColor={dark ? '#4a4a42' : '#a49c89'}
          fadeDistance={90} fadeStrength={1.5} position={[0, low - 0.01, 0]} />{/* on the lowest ground, so it never floats over a sunken yard */}
        <Crew run={`${b.name}|${b.levels.length}`} name={b.name}>{/* puts a new building up piece by piece */}
          {parts.map((p, i) => p.kind === 'slab'
            ? <Slab key={i} p={p} mat={mats.slab} />
            : <mesh key={i} material={matOf(p)} position={p.center} rotation={[0, p.rotY, 0]} castShadow={p.kind !== 'glass'} receiveShadow>
                <boxGeometry args={p.size} />
              </mesh>)}
        </Crew>
        {labels.map((l, i) => (
          <Html key={i} position={l.pos} center zIndexRange={[10, 0]}><span className="dim-label mono">{l.text}</span></Html>
        ))}
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2 - 0.02} />
        <Fit b={b} />{/* after the controls: its effect needs them registered (effects run in tree order) */}
      </Canvas>

      <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
      <p className="tag mono"><b>02</b> View · true scale, metres</p>

      <div className="readout num">
        <span className="dims"><span>W</span>{e.width.toFixed(2)} <span>D</span>{e.depth.toFixed(2)} <span>H</span>{(e.height - e.ground).toFixed(2)} <span>m outside, ground to roof top</span></span>
        <span>{under > 0 && `lowest floor: ${under.toFixed(2)} m below ground · `}grid: 1 m squares, heavier line every 5 m</span>
      </div>
      <div className="tools">
        <button type="button" onClick={() => controls.current?.reset()}>Reset view</button>
        <button type="button" aria-pressed={!roof} onClick={() => setRoof(!roof)}>Lift roof</button>
        {b.levels.length > 1 && (
          <button type="button" aria-pressed={shownLevels < b.levels.length} onClick={() => setHidden(shownLevels > 1 ? b.levels.length - shownLevels + 1 : 0)}>
            {shownLevels < b.levels.length ? `Floors 1 to ${shownLevels}` : 'All floors'}
          </button>
        )}
        <button type="button" onClick={download}>Download .glb</button>
      </div>
    </section>
  );
}
