// 3D-модель босса на three.js: «рентген»-тело с подписями здоровья по частям и снаряжение поверх него.
// Тело и снаряжение собраны из простых фигур — это схема, а не модель из игры.
// Модель медленно вращается (если в системе не включено «уменьшить движение»), её можно крутить мышью или пальцем.
// При наведении на часть тела или предмет снаряжения появляется подсказка.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, PART_RU, PartId, Health, hpOf, ratio, PMC } from '../health';

export type GearPiece = { slot: string; name: string };

type Layout = { pos: [number, number, number]; kind: 'sphere' | 'capsule' | 'box'; size: [number, number, number]; rotZ?: number };

// Фигура смотрит на камеру (+Z): левая сторона персонажа — справа на экране (+X).
const LAYOUT: Record<PartId, Layout> = {
  Head: { pos: [0, 1.66, 0], kind: 'sphere', size: [0.13, 0, 0] },
  Chest: { pos: [0, 1.32, 0], kind: 'box', size: [0.42, 0.34, 0.22] },
  Stomach: { pos: [0, 1.02, 0], kind: 'box', size: [0.36, 0.22, 0.2] },
  LeftArm: { pos: [0.31, 1.16, 0], kind: 'capsule', size: [0.06, 0.46, 0], rotZ: 0.12 },
  RightArm: { pos: [-0.31, 1.16, 0], kind: 'capsule', size: [0.06, 0.46, 0], rotZ: -0.12 },
  LeftLeg: { pos: [0.11, 0.46, 0], kind: 'capsule', size: [0.075, 0.66, 0] },
  RightLeg: { pos: [-0.11, 0.46, 0], kind: 'capsule', size: [0.075, 0.66, 0] },
};

// Где подпись части тела стоит на экране относительно самой части (сдвиг в метрах по X)
const LABEL_SIDE: Record<PartId, number> = { Head: 0.42, Chest: 0, Stomach: 0, LeftArm: 0.36, RightArm: -0.36, LeftLeg: 0.32, RightLeg: -0.32 };

function makeGeometry(l: Layout) {
  if (l.kind === 'sphere') return new THREE.SphereGeometry(l.size[0], 32, 24);
  if (l.kind === 'capsule') return new THREE.CapsuleGeometry(l.size[0], l.size[1], 8, 20);
  const g = new THREE.CapsuleGeometry(0.5, 0.4, 8, 24);
  g.scale(l.size[0], l.size[1] / 1.4, l.size[2]);
  return g;
}

const SLOT_RU: Record<string, string> = {
  FirstPrimaryWeapon: 'Основное оружие', SecondPrimaryWeapon: 'Второе оружие', Holster: 'Пистолет', Scabbard: 'Нож',
  Headwear: 'Головной убор', FaceCover: 'Маска', Earpiece: 'Наушники', Eyewear: 'Очки',
  ArmorVest: 'Бронежилет', TacticalVest: 'Разгрузка', Backpack: 'Рюкзак',
};

// Схематичные предметы снаряжения
function makeGear(slot: string): THREE.Object3D | null {
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.35, metalness: 0.7 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
  };
  switch (slot) {
    case 'Headwear': add(new THREE.SphereGeometry(0.15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 1.68, 0); break;
    case 'FaceCover': add(new THREE.BoxGeometry(0.2, 0.17, 0.05), metal, 0, 1.65, 0.12); break;
    case 'Earpiece':
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), dark, 0.135, 1.66, 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), dark, -0.135, 1.66, 0, 0, 0, Math.PI / 2); break;
    case 'Eyewear': add(new THREE.BoxGeometry(0.2, 0.04, 0.03), metal, 0, 1.69, 0.13); break;
    case 'ArmorVest': add(new THREE.BoxGeometry(0.46, 0.5, 0.29), dark, 0, 1.22, 0); break;
    case 'TacticalVest': {
      add(new THREE.BoxGeometry(0.44, 0.48, 0.27), dark, 0, 1.22, 0);
      for (const x of [-0.12, 0, 0.12]) add(new THREE.BoxGeometry(0.09, 0.13, 0.06), dark, x, 1.12, 0.16);
      break;
    }
    case 'Backpack': add(new THREE.BoxGeometry(0.36, 0.44, 0.18), dark, 0, 1.22, -0.24); break;
    case 'FirstPrimaryWeapon': {
      const w = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.62), metal); w.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 12), metal); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.45; w.add(barrel);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), metal); mag.position.set(0, -0.12, 0.08); mag.rotation.x = 0.25; w.add(mag);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.22), metal); stock.position.set(0, -0.02, -0.4); w.add(stock);
      w.position.set(-0.08, 1.08, 0.24); w.rotation.set(0, 0.2, 0.75);
      g.add(w); break;
    }
    case 'SecondPrimaryWeapon': add(new THREE.BoxGeometry(0.06, 0.7, 0.08), metal, 0.08, 1.25, -0.22, 0, 0, 0.5); break;
    case 'Holster': add(new THREE.BoxGeometry(0.07, 0.16, 0.12), dark, -0.24, 0.92, 0.03); break;
    case 'Scabbard': add(new THREE.BoxGeometry(0.035, 0.2, 0.03), metal, 0.12, 1.32, 0.16, 0, 0, -0.4); break;
    default: return null;
  }
  return g;
}

const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export default function Boss3D({ name, health, gear = [] }: { name: string; health: Health; gear?: GearPiece[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const apiRef = useRef<{ setBoss: (h: Health, gear: GearPiece[]) => void; showGear: (v: boolean) => void } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [gearOn, setGearOn] = useState(true);

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
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 1.45, 5);

    scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x15181a, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(2, 3, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd2ff, 1.2); rim.position.set(-3, 2, -2); scene.add(rim);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.85, 64), new THREE.MeshBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.06 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.83, 0.86, 64), new THREE.MeshBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; scene.add(ring);

    // «Рентген»: полупрозрачное светящееся тело с контурами
    const body = new THREE.Group(); scene.add(body);
    const meshes: Record<string, THREE.Mesh> = {};
    for (const id of PARTS) {
      const l = LAYOUT[id];
      const mat = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x6fb7ff, emissiveIntensity: 0.35, transparent: true, opacity: 0.32, roughness: 0.3, depthWrite: false });
      const m = new THREE.Mesh(makeGeometry(l), mat);
      m.position.set(...l.pos);
      if (l.rotZ) m.rotation.z = l.rotZ;
      m.userData = { kind: 'part', id };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.35 }));
      m.add(edges);
      body.add(m);
      meshes[id] = m;
    }

    const gearGroup = new THREE.Group(); scene.add(gearGroup);
    const setGear = (pieces: GearPiece[]) => {
      gearGroup.children.slice().forEach((c) => { gearGroup.remove(c); c.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); });
      for (const p of pieces) {
        const obj = makeGear(p.slot);
        if (!obj) continue;
        obj.traverse((o) => { o.userData = { kind: 'gear', id: `${SLOT_RU[p.slot] || p.slot}: ${p.name}` }; });
        gearGroup.add(obj);
      }
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.95, 0);
    controls.enablePan = false; controls.enableZoom = false; controls.enableDamping = true;
    controls.minPolarAngle = 0.6; controls.maxPolarAngle = 1.9;
    controls.autoRotate = !reducedMotion(); controls.autoRotateSpeed = 1.4;

    let animStart = performance.now();
    apiRef.current = {
      setBoss: (_h, pieces) => { animStart = performance.now(); setGear(pieces); },
      showGear: (v) => { gearGroup.visible = v; },
    };

    const resize = () => {
      const w = wrap.clientWidth, hgt = wrap.clientHeight;
      renderer.setSize(w, hgt, false);
      camera.aspect = w / Math.max(1, hgt);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();

    const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
    let hovered: string | null = null;
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const targets = [...(gearGroup.visible ? [gearGroup] : []), body];
      const hit = ray.intersectObjects(targets, true).find((h) => (h.object as any).isMesh);
      const id = (hit?.object.userData.id as string) || null;
      if (id !== hovered) { hovered = id; setHover(id); }
    };
    const onLeave = () => { hovered = null; setHover(null); };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const v = new THREE.Vector3();
    const tick = (now: number) => {
      const t = Math.min(1, (now - animStart) / 900);
      const ease = 1 - Math.pow(1 - t, 3);
      // Появление: тело «проявляется», снаряжение опускается на место
      for (const id of PARTS) {
        const mat = meshes[id].material as THREE.MeshStandardMaterial;
        const isHover = hovered === id;
        mat.opacity = 0.32 * ease + (isHover ? 0.35 : 0);
        mat.emissive.setHex(isHover ? 0xff8a3d : 0x6fb7ff);
        mat.emissiveIntensity = isHover ? 0.9 : 0.35 + (reducedMotion() ? 0 : Math.sin(now / 600) * 0.08);
      }
      gearGroup.position.y = (1 - ease) * 0.4;
      gearGroup.children.forEach((c) => c.traverse((o: any) => {
        if (!o.material) return;
        o.material.transparent = true;
        o.material.opacity = ease;
        o.material.emissive?.setHex(hovered && o.userData.id === hovered ? 0x8a4a1d : 0x000000);
      }));
      controls.update();
      renderer.render(scene, camera);
      const w = wrap.clientWidth, hgt = wrap.clientHeight;
      for (const id of PARTS) {
        const el = labelRefs.current[id];
        if (!el) continue;
        meshes[id].getWorldPosition(v);
        // Подпись — сбоку от части тела в плоскости экрана
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        v.addScaledVector(right, LABEL_SIDE[id]);
        if (id === 'Head') v.y += 0.12;
        if (id === 'Stomach') v.y -= 0.02;
        v.project(camera);
        el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px)`;
        el.style.opacity = String(Math.min(1, ease * 1.3));
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

  useEffect(() => { apiRef.current?.setBoss(health, gear); }, [health, gear]);
  useEffect(() => { apiRef.current?.showGear(gearOn); }, [gearOn]);

  if (failed) return <div className="state small">3D недоступно на этом устройстве (WebGL выключен).</div>;

  const hoverPart = (PARTS as string[]).includes(hover || '') ? (hover as PartId) : null;

  return (
    <div className="boss3d" ref={wrapRef} aria-label={`3D-модель: ${name}`}>
      {PARTS.map((id) => (
        <div key={id} className={`hp-plate ${hover === id ? 'on' : ''}`} ref={(el) => { labelRefs.current[id] = el; }}>
          <div className="hp-plate-name">{PART_RU[id]}</div>
          <div className="hp-plate-bar"><span>{hpOf(health, id)}/{hpOf(health, id)}</span></div>
        </div>
      ))}
      {hover && (
        <div className="boss3d-tip">
          {hoverPart
            ? <><b>{PART_RU[hoverPart]}</b>: {hpOf(health, hoverPart)} HP · у ЧВК {PMC[hoverPart]} · ×{ratio(health, hoverPart).toFixed(1)}</>
            : <>{hover}</>}
        </div>
      )}
      {gear.length > 0 && (
        <button className="btn ghost small boss3d-toggle" onClick={() => setGearOn(!gearOn)}>{gearOn ? 'Скрыть снаряжение' : 'Показать снаряжение'}</button>
      )}
      <div className="boss3d-hint small muted">Крутите мышью или пальцем · наведите на часть тела или снаряжение</div>
    </div>
  );
}
