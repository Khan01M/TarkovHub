// 3D-модель здоровья босса на three.js.
// Тело собрано из простых фигур. Цвет и толщина каждой части — во сколько раз она крепче, чем у обычного ЧВК.
// Модель медленно вращается (если в системе не включено «уменьшить движение»), её можно крутить мышью или пальцем.
// При смене босса части «собираются» с анимацией, а над ними подписаны очки здоровья.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, PART_RU, PartId, Health, hpOf, ratio, rgbFor, PMC } from '../health';

type Layout = { pos: [number, number, number]; kind: 'sphere' | 'capsule' | 'box'; size: [number, number, number]; rotZ?: number };

// Фигура смотрит на камеру (+Z): левая сторона персонажа — справа на экране (+X).
const LAYOUT: Record<PartId, Layout> = {
  Head: { pos: [0, 1.66, 0], kind: 'sphere', size: [0.14, 0, 0] },
  Chest: { pos: [0, 1.32, 0], kind: 'box', size: [0.42, 0.34, 0.22] },
  Stomach: { pos: [0, 1.02, 0], kind: 'box', size: [0.36, 0.22, 0.2] },
  LeftArm: { pos: [0.31, 1.16, 0], kind: 'capsule', size: [0.065, 0.46, 0], rotZ: 0.12 },
  RightArm: { pos: [-0.31, 1.16, 0], kind: 'capsule', size: [0.065, 0.46, 0], rotZ: -0.12 },
  LeftLeg: { pos: [0.11, 0.46, 0], kind: 'capsule', size: [0.08, 0.66, 0], rotZ: 0 },
  RightLeg: { pos: [-0.11, 0.46, 0], kind: 'capsule', size: [0.08, 0.66, 0], rotZ: 0 },
};

function makeGeometry(l: Layout) {
  if (l.kind === 'sphere') return new THREE.SphereGeometry(l.size[0], 32, 24);
  if (l.kind === 'capsule') return new THREE.CapsuleGeometry(l.size[0], l.size[1], 8, 20);
  // скруглённый «корпус» из капсулы, растянутой по осям
  const g = new THREE.CapsuleGeometry(0.5, 0.4, 8, 24);
  g.scale(l.size[0], l.size[1] / 1.4, l.size[2]);
  return g;
}

// Толщина: крепче — толще, но в разумных пределах
const thick = (r: number) => 1 + Math.min(Math.max(r - 1, 0), 4) * 0.09;

const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export default function Boss3D({ name, health }: { name: string; health: Health }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const apiRef = useRef<{ setHealth: (h: Health) => void } | null>(null);
  const [hover, setHover] = useState<PartId | null>(null);
  const [failed, setFailed] = useState(false);

  // Сцена создаётся один раз
  useEffect(() => {
    const wrap = wrapRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.domElement.className = 'boss3d-canvas';
    wrap.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 1.55, 4.7);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a1c1b, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0xc7b37a, 1.4); rim.position.set(-3, 2, -2); scene.add(rim);

    // Подиум и сетка
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 64), new THREE.MeshStandardMaterial({ color: 0x1e2221, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 0.92, 64), new THREE.MeshBasicMaterial({ color: 0xc7b37a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; scene.add(ring);

    const body = new THREE.Group();
    scene.add(body);
    const meshes: Record<string, THREE.Mesh> = {};
    for (const id of PARTS) {
      const l = LAYOUT[id];
      const m = new THREE.Mesh(makeGeometry(l), new THREE.MeshStandardMaterial({ color: 0x5fbf6a, roughness: 0.45, metalness: 0.15, emissive: 0x000000 }));
      m.position.set(...l.pos);
      if (l.rotZ) m.rotation.z = l.rotZ;
      m.userData.id = id;
      body.add(m);
      meshes[id] = m;
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.92, 0);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 0.6; controls.maxPolarAngle = 1.9;
    controls.autoRotate = !reducedMotion();
    controls.autoRotateSpeed = 1.6;

    // Анимация смены босса: части собираются из «рассыпанного» состояния
    const anim: Record<string, { from: number; to: number; ratio: number }> = {};
    let animStart = 0;
    const setHealth = (h: Health) => {
      animStart = performance.now();
      for (const id of PARTS) {
        const r = ratio(h, id);
        const mat = meshes[id].material as THREE.MeshStandardMaterial;
        const [cr, cg, cb] = rgbFor(r);
        mat.color.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
        mat.emissive.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
        anim[id] = { from: 0.4, to: thick(r), ratio: r };
      }
    };
    apiRef.current = { setHealth };

    const resize = () => {
      const w = wrap.clientWidth, hgt = wrap.clientHeight;
      renderer.setSize(w, hgt, false);
      camera.aspect = w / Math.max(1, hgt);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();

    // Наведение: подсветка части
    const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
    let hovered: string | null = null;
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(body.children, false)[0];
      const id = (hit?.object.userData.id as string) || null;
      if (id !== hovered) { hovered = id; setHover(id as PartId | null); }
    };
    const onLeave = () => { hovered = null; setHover(null); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    // Подписи над частями тела следуют за моделью
    const v = new THREE.Vector3();
    const tick = (now: number) => {
      const t = Math.min(1, (now - animStart) / 900);
      const ease = 1 - Math.pow(1 - t, 3);
      for (const id of PARTS) {
        const m = meshes[id]; const a = anim[id];
        if (!a) continue;
        const delay = PARTS.indexOf(id) * 0.06;
        const tt = Math.min(1, Math.max(0, (t - delay) / (1 - delay)));
        const e = 1 - Math.pow(1 - tt, 3);
        const s = a.from + (a.to - a.from) * e;
        const l = LAYOUT[id];
        // Голова и корпус растут равномерно, руки и ноги — в толщину
        if (l.kind === 'capsule') m.scale.set(s, 0.85 + 0.15 * e, s); else m.scale.setScalar(s);
        m.position.y = l.pos[1] + (1 - e) * 0.35;
        // «Пульс» свечения: чем крепче часть, тем ярче
        const mat = m.material as THREE.MeshStandardMaterial;
        const pulse = reducedMotion() ? 0 : (Math.sin(now / 420 + PARTS.indexOf(id)) + 1) / 2;
        mat.emissiveIntensity = (hovered === id ? 0.55 : 0.06 + Math.min(a.ratio, 5) * 0.03 * pulse) * (ease > 0 ? 1 : 0);
      }
      controls.update();
      renderer.render(scene, camera);
      const w = wrap.clientWidth, hgt = wrap.clientHeight;
      for (const id of PARTS) {
        const el = labelRefs.current[id];
        if (!el) continue;
        meshes[id].getWorldPosition(v);
        v.y += LAYOUT[id].kind === 'sphere' ? 0.22 : 0;
        v.project(camera);
        const behind = v.z > 1;
        el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
        el.style.opacity = behind ? '0' : String(Math.min(1, ease * 1.4));
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      scene.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => { apiRef.current?.setHealth(health); }, [health]);

  if (failed) return <div className="state small">3D недоступно на этом устройстве (WebGL выключен).</div>;

  return (
    <div className="boss3d" ref={wrapRef} aria-label={`3D-модель здоровья: ${name}`}>
      {PARTS.map((id) => (
        <div key={id} className={`boss3d-label ${hover === id ? 'on' : ''}`} ref={(el) => { labelRefs.current[id] = el; }}>
          {hpOf(health, id)}
        </div>
      ))}
      {hover && (
        <div className="boss3d-tip">
          <b>{PART_RU[hover]}</b>: {hpOf(health, hover)} HP · у ЧВК {PMC[hover]} · ×{ratio(health, hover).toFixed(1)}
        </div>
      )}
      <div className="boss3d-hint small muted">Крутите мышью или пальцем</div>
    </div>
  );
}
