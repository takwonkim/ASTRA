import * as THREE from 'three';
import { OBSERVERS, SKY_RATES, equatorialVector, horizontalVector, altitudeAzimuth, tonight } from './sky-math.js?v=3';

const DEG = Math.PI / 180;
const RADIUS = 2000;
let catalogPromise;

export function loadSkyCatalog() {
  if (!catalogPromise) catalogPromise = fetch(new URL('../data/sky.json?v=3', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error('별자리 자료를 불러오지 못했습니다.');
    return response.json();
  }).catch((error) => { catalogPromise = null; throw error; });
  return catalogPromise;
}

export function createSkyMode(data, camera, canvas, { observer = OBSERVERS[0], date = tonight(observer), pixelRatio = 1, onStar } = {}) {
  const root = new THREE.Group();
  const frame = new THREE.Group();
  frame.matrixAutoUpdate = false;
  root.add(frame);
  const state = { observer: { ...observer }, time: date.getTime(), names: true, lines: true };
  const anchors = [];
  const starAnchor = new THREE.Object3D();
  frame.add(starAnchor);
  let yaw = 0, pitch = 40 * DEG, aim = null;
  const pointers = new Map();
  let multiple = false;

  const positions = [], colors = [], sizes = [], brightness = [];
  for (const [, ra, dec, mag, bv] of data.stars) {
    positions.push(...equatorialVector(ra, dec).map((value) => value * RADIUS));
    const color = bv < .2 ? new THREE.Color('#b8d2ff').lerp(new THREE.Color('#fffaf1'), THREE.MathUtils.clamp((bv + .4) / .6, 0, 1)) : new THREE.Color('#fffaf1').lerp(new THREE.Color('#ffc082'), THREE.MathUtils.clamp((bv - .2) / 1.6, 0, 1));
    colors.push(color.r, color.g, color.b);
    sizes.push(2.2 + 5 * Math.exp(-.32 * (mag + 1.5)));
    brightness.push(.22 + .78 * Math.exp(-.5 * Math.max(0, mag)));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('brightness', new THREE.Float32BufferAttribute(brightness, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { ratio: { value: pixelRatio }, fieldOfView: { value: 80 } }, transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float size;attribute float brightness;uniform float ratio;uniform float fieldOfView;varying vec3 tint;varying float light;varying float altitude;void main(){vec4 world=modelMatrix*vec4(position,1.);altitude=world.y;tint=color;light=brightness;gl_Position=projectionMatrix*viewMatrix*world;gl_PointSize=size*ratio*sqrt(80./fieldOfView);}',
    fragmentShader: 'varying vec3 tint;varying float light;varying float altitude;void main(){if(altitude<0.)discard;vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float core=exp(-r*6.);float halo=.28*exp(-r*1.5);gl_FragColor=vec4(tint,(core+halo)*light);}'
  });
  frame.add(new THREE.Points(geometry, material));

  const linePositions = [];
  for (const constellation of data.constellations) {
    const anchor = new THREE.Object3D();
    anchor.position.set(...equatorialVector(...constellation.center)).multiplyScalar(RADIUS);
    frame.add(anchor);
    anchors.push({ constellation, object: anchor });
    for (const path of constellation.lines) for (let i = 1; i < path.length; i++) {
      const a = new THREE.Vector3(...equatorialVector(...path[i - 1]));
      const b = new THREE.Vector3(...equatorialVector(...path[i]));
      const steps = Math.max(1, Math.ceil(a.angleTo(b) / (2 * DEG)));
      for (let j = 0; j < steps; j++) {
        linePositions.push(...a.clone().lerp(b, j / steps).normalize().multiplyScalar(RADIUS).toArray());
        linePositions.push(...a.clone().lerp(b, (j + 1) / steps).normalize().multiplyScalar(RADIUS).toArray());
      }
    }
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: '#69b3dd', transparent: true, opacity: .48, depthWrite: false }));
  frame.add(lines);

  const ground = new THREE.Mesh(new THREE.SphereGeometry(RADIUS - 5, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0a1420', side: THREE.BackSide }));
  root.add(ground);
  const horizon = Array.from({ length: 240 }, (_, i) => new THREE.Vector3(Math.sin(i / 240 * Math.PI * 2) * (RADIUS - 8), 0, -Math.cos(i / 240 * Math.PI * 2) * (RADIUS - 8)));
  root.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(horizon), new THREE.LineBasicMaterial({ color: '#486b83', transparent: true, opacity: .55 })));
  const directions = ['북', '동', '남', '서'].map((name, index) => {
    const object = new THREE.Object3D();
    object.position.set(Math.sin(index * Math.PI / 2) * 1990, 20, -Math.cos(index * Math.PI / 2) * 1990);
    root.add(object);
    return { name, object };
  });

  function updateFrame() {
    const date = new Date(state.time);
    const x = new THREE.Vector3(...horizontalVector(0, 0, date, state.observer));
    const y = new THREE.Vector3(...horizontalVector(0, 90, date, state.observer));
    const z = new THREE.Vector3(...horizontalVector(270, 0, date, state.observer));
    frame.matrix.makeBasis(x, y, z);
    frame.matrixWorldNeedsUpdate = true;
    lines.visible = state.lines;
  }

  function updateCamera(dt = 1) {
    if (aim) {
      const factor = 1 - Math.exp(-dt * 8);
      const difference = Math.atan2(Math.sin(aim.yaw - yaw), Math.cos(aim.yaw - yaw));
      yaw += difference * factor;
      pitch += (aim.pitch - pitch) * factor;
      if (Math.abs(difference) < .001 && Math.abs(aim.pitch - pitch) < .001) aim = null;
    }
    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    material.uniforms.fieldOfView.value = camera.fov;
  }

  function coordinates(ra, dec) { return altitudeAzimuth(ra, dec, new Date(state.time), state.observer); }

  function focus(ra, dec) {
    const at = coordinates(ra, dec);
    if (at.altitude < 0) return false;
    aim = { yaw: at.azimuth * DEG, pitch: THREE.MathUtils.clamp(at.altitude * DEG, 0, 88 * DEG) };
    return true;
  }

  function recommend() {
    const familiar = ['Ori', 'Cas', 'UMa', 'Cyg', 'Sco', 'Tau', 'Leo', 'Peg', 'And', 'Cru'];
    return data.constellations.map((entry) => ({ entry, altitude: coordinates(...entry.center).altitude }))
      .filter(({ altitude }) => altitude > 15 && altitude < 80)
      .sort((a, b) => (familiar.includes(b.entry.id) ? 40 : 0) - (familiar.includes(a.entry.id) ? 40 : 0) + Math.abs(a.altitude - 50) - Math.abs(b.altitude - 50))[0]?.entry;
  }

  function zoom(factor) { camera.fov = THREE.MathUtils.clamp(camera.fov * factor, 25, 110); camera.updateProjectionMatrix(); }

  function pick(clientX, clientY) {
    root.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const rect = canvas.getBoundingClientRect();
    let nearest = null, minimum = 16;
    const vector = new THREE.Vector3();
    for (const star of data.stars) {
      vector.set(...equatorialVector(star[1], star[2])).applyMatrix4(frame.matrix);
      if (vector.y < 0) continue;
      vector.multiplyScalar(RADIUS).project(camera);
      if (vector.z > 1 || vector.z < -1) continue;
      const distance = Math.hypot(rect.left + (vector.x * .5 + .5) * rect.width - clientX, rect.top + (-vector.y * .5 + .5) * rect.height - clientY);
      if (distance < minimum) { minimum = distance; nearest = star; }
    }
    if (nearest) onStar?.(nearest);
  }

  function down(event) {
    if (event.button > 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: 0 });
    if (pointers.size > 1) multiple = true;
    aim = null;
  }

  function move(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const old = [...pointers.values()].map((p) => ({ ...p }));
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer.x = event.clientX; pointer.y = event.clientY;
    pointer.moved = Math.max(pointer.moved, Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY));
    if (pointers.size === 1) { yaw -= dx * .004 * camera.fov / 80; pitch = THREE.MathUtils.clamp(pitch + dy * .004 * camera.fov / 80, -5 * DEG, 88 * DEG); }
    else if (pointers.size === 2) {
      const current = [...pointers.values()];
      const before = Math.hypot(old[0].x - old[1].x, old[0].y - old[1].y);
      const after = Math.hypot(current[0].x - current[1].x, current[0].y - current[1].y);
      if (after > 5 && before > 5) zoom(before / after);
    }
    updateCamera(0);
  }

  function up(event) {
    const pointer = pointers.get(event.pointerId);
    if (pointer && !multiple && pointer.moved < 6 && event.type !== 'pointercancel') pick(event.clientX, event.clientY);
    pointers.delete(event.pointerId);
    if (!pointers.size) multiple = false;
  }

  function wheel(event) { event.preventDefault(); zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY, -300, 300) * .0015)); }
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['wheel', wheel]];
  for (const [name, handler] of listeners) canvas.addEventListener(name, handler, { passive: false });
  camera.fov = 80;
  camera.updateProjectionMatrix();
  updateFrame();
  updateCamera();
  return {
    root, anchors, directions, state, coordinates, focus, recommend, zoom,
    markStar(star) { starAnchor.position.set(...equatorialVector(star[1], star[2])).multiplyScalar(RADIUS); return starAnchor; },
    setObserver(observer) { state.observer = { ...observer }; updateFrame(); },
    setDate(date) { state.time = date.getTime(); updateFrame(); },
    step(dt, paused, direction, rate) { if (!paused) state.time += dt * SKY_RATES[rate] * direction * 1000; updateFrame(); updateCamera(dt); },
    dispose() { for (const [name, handler] of listeners) canvas.removeEventListener(name, handler); pointers.clear(); }
  };
}
