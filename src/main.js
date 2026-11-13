import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STAR_COUNT, TAU, hash, random, galaxiesInSector, starAt, makeSystem, orbitPosition, visualOrbit, visualRadius, planetKinds } from './universe.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { view: 'galaxy', sector: 0, galaxy: null, star: null, planets: [], selected: null, years: 0, paused: false, direction: 1, speed: 3, orbits: true };
const speeds = { galaxy: [1e3, 1e4, 1e5, 1e6, 1e7, 5e7, 1e8], cluster: [1e3, 1e4, 1e5, 1e6, 1e7, 5e7, 1e8], system: [0.01, 0.1, 1, 10, 100, 1000, 10000].map((days) => days / 365.25) };
let renderer, scene, camera, controls, world, galaxyGroup, orbitGroup, background;
let labels = [], pickables = [], planetMeshes = [], starSurface, animation = null, follow = null, previousFollow = null;
let listItems = [], galaxyCatalog = galaxiesInSector(), lastFrame = 0, lastUI = 0, toastTimer, rebuilding = false;
const vector = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const decimal = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

function readable(value, digits = 1) {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${decimal.format(+(value / 1e8).toFixed(digits))}억`;
  if (abs >= 1e4) return `${decimal.format(+(value / 1e4).toFixed(digits))}만`;
  return decimal.format(+value.toFixed(digits));
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.08, 'rgba(255,255,255,.95)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,.3)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,.065)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

let glow;
function sprite(color, size, opacity = 1) {
  const result = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  result.scale.set(size, size, 1);
  return result;
}

function pointCloud(positions, colors, size, opacity = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ size, map: glow, transparent: true, vertexColors: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
}

function createGalaxy(galaxy, count, radius) {
  const group = new THREE.Group();
  const positions = [], colors = [], dustPositions = [], dustColors = [];
  const tint = new THREE.Color();
  const scale = radius / 150;
  for (let index = 0; index < count; index++) {
    const star = starAt(galaxy, index);
    const r = Math.hypot(star.position[0], star.position[2]);
    positions.push(...star.position.map((v) => v * scale));
    tint.set(star.color);
    if (r < 25) tint.lerp(new THREE.Color('#ffd5a3'), 0.65);
    else tint.lerp(new THREE.Color().setHSL(galaxy.hue, 0.55, 0.7), 0.35);
    colors.push(tint.r, tint.g, tint.b);
    if (index % 7 === 0) {
      dustPositions.push(...star.position.map((v) => v * scale));
      tint.setHSL(galaxy.hue + 0.015 * Math.sin(index), 0.6, r < 30 ? 0.5 : 0.4);
      if (r < 25) tint.set('#a08163');
      dustColors.push(tint.r, tint.g, tint.b);
    }
  }
  const stars = pointCloud(positions, colors, 1.3 * scale, 0.9);
  group.add(stars);
  group.add(pointCloud(dustPositions, dustColors, 21 * scale, 0.12));
  const core = sprite('#e7c4a0', radius * 0.5, 0.9);
  core.scale.y *= 0.8;
  group.add(core);
  group.add(sprite('#ffdcac', radius * 0.15, 0.8));
  group.userData.stars = stars;
  return group;
}

function createBackground() {
  const rng = random('astra-background');
  const positions = [], colors = [];
  for (let i = 0; i < 1700; i++) {
    const a = rng() * TAU, z = rng() * 2 - 1, r = Math.sqrt(1 - z * z);
    positions.push(Math.cos(a) * r * 2500, z * 2500, Math.sin(a) * r * 2500);
    const c = new THREE.Color().setHSL(0.55 + rng() * 0.12, 0.12 + rng() * 0.3, 0.3 + rng() * 0.5);
    colors.push(c.r, c.g, c.b);
  }
  background = pointCloud(positions, colors, 5, 0.8);
  scene.add(background);
}

function disposeWorld() {
  if (!world) return;
  const textures = new Set();
  world.traverse((object) => {
    object.geometry?.dispose();
    for (const material of [object.material].flat().filter(Boolean)) {
      if (material.map && material.map !== glow) textures.add(material.map);
      material.dispose();
    }
  });
  textures.forEach((texture) => texture.dispose());
  scene.remove(world);
}

function clearWorld() {
  disposeWorld();
  world = new THREE.Group();
  scene.add(world);
  labels = [];
  pickables = [];
  planetMeshes = [];
  $('labels').replaceChildren();
  galaxyGroup = null;
  orbitGroup = null;
  starSurface = null;
  animation = null;
  follow = null;
  previousFollow = null;
}

function addLabel(name, object, onClick, options = {}) {
  const button = document.createElement('button');
  button.className = `sky-label${options.selected ? ' selected' : ''}`;
  const dot = document.createElement('i');
  const text = document.createElement('span');
  text.textContent = name;
  if (options.caption) { const small = document.createElement('small'); small.textContent = options.caption; text.append(small); }
  button.append(dot, text);
  button.setAttribute('aria-label', `선택: ${name}`);
  button.addEventListener('click', onClick);
  $('labels').append(button);
  const label = { button, object, key: options.key, priority: options.priority ?? 0 };
  labels.push(label);
  return label;
}

function moveCamera(position, target = [0, 0, 0], duration = 1000) {
  if (reduceMotion) duration = 0;
  animation = { start: performance.now(), duration, from: camera.position.clone(), to: new THREE.Vector3(...position), fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(...target) };
  controls.enabled = false;
}

function entrance(position) {
  controls.target.set(0, 0, 0);
  camera.position.set(...position.map((value) => value * 1.13));
  controls.update();
  moveCamera(position, [0, 0, 0], 1200);
  $('warp').classList.remove('active');
  void $('warp').offsetWidth;
  $('warp').classList.add('active');
}

function buildCluster() {
  clearWorld();
  galaxyCatalog = galaxiesInSector(state.sector);
  for (const galaxy of galaxyCatalog) {
    const mesh = createGalaxy(galaxy, 2200, galaxy.size);
    mesh.position.set(...galaxy.position);
    mesh.rotation.set(0.15 + (hash(galaxy.id) % 8) * 0.09, (hash(galaxy.id) % 7) * 0.3, 0.1);
    mesh.userData.baseRotationY = mesh.rotation.y;
    world.add(mesh);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(galaxy.size * 0.8, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    mesh.add(hit);
    hit.userData.select = () => selectGalaxy(galaxy);
    pickables.push(hit);
    addLabel(galaxy.name, mesh, () => selectGalaxy(galaxy), { key: galaxy.id, caption: galaxy.real ? galaxy.code : '미지의 은하', priority: galaxy.id === state.galaxy.id ? 2 : 0 });
  }
  controls.minDistance = 80;
  controls.maxDistance = 2200;
  entrance([40, 470, 740]);
  listItems = galaxyCatalog.map((data) => ({ name: data.name, subtitle: data.kind, color: '#b5ccf0', type: 'galaxy', key: data.id, real: data.real, data }));
  selectGalaxy(galaxyCatalog.find((g) => g.id === state.galaxy.id) || galaxyCatalog[0]);
}

function buildGalaxy() {
  clearWorld();
  galaxyGroup = createGalaxy(state.galaxy, STAR_COUNT, 150);
  world.add(galaxyGroup);
  galaxyGroup.userData.stars.userData.galaxyStars = true;
  pickables.push(galaxyGroup.userData.stars);
  orbitGroup = new THREE.Group();
  const ringPoints = [];
  for (let i = 0; i < 160; i++) { const a = i / 160 * TAU; ringPoints.push(new THREE.Vector3(Math.cos(a) * 166, 0, Math.sin(a) * 166)); }
  orbitGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color: '#5a789d', transparent: true, opacity: 0.13 })));
  world.add(orbitGroup);
  const indices = [0, ...Array.from({ length: 21 }, (_, i) => 17 + (hash(state.galaxy.id) + i * 929) % (STAR_COUNT - 30))];
  if (!indices.includes(state.star.id)) indices.push(state.star.id);
  listItems = indices.map((index) => {
    const star = starAt(state.galaxy, index);
    return { name: star.name, subtitle: `${star.type}형 · ${star.label}`, color: star.color, type: 'star', key: star.id, real: star.real, data: star };
  });
  for (const item of listItems.slice(0, 7)) addStarLabel(item.data);
  controls.minDistance = 8;
  controls.maxDistance = 850;
  entrance([25, 205, 310]);
  selectStar(state.star);
}

function addStarLabel(star) {
  if (labels.some((label) => label.key === star.id)) return;
  const anchor = new THREE.Object3D();
  anchor.position.set(...star.position);
  galaxyGroup.add(anchor);
  addLabel(star.name, anchor, () => selectStar(star), { key: star.id, selected: star.id === state.star.id, priority: star.id === state.star.id ? 3 : 0 });
}

function surfaceTexture(planet) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  const rng = random(planet.seed);
  const phases = Array.from({ length: 18 }, () => rng() * TAU);
  const base = new THREE.Color(planet.color);
  const land = new THREE.Color(planet.kind === 'ocean' ? '#72896b' : '#b29a7e');
  const light = new THREE.Color('#e8e3d3');
  for (let y = 0; y < canvas.height; y++) {
    const lat = y / canvas.height * Math.PI;
    for (let x = 0; x < canvas.width; x++) {
      const lon = x / canvas.width * TAU;
      const a = Math.cos(lon) * Math.sin(lat), b = Math.sin(lon) * Math.sin(lat), c = Math.cos(lat);
      let noise = 0;
      for (let i = 0; i < 5; i++) {
        const f = 3 * 2 ** i;
        noise += Math.sin(a * f + phases[i]) * Math.cos(b * f + phases[i + 5]) * Math.sin(c * f + phases[i + 10]) / 2 ** i;
      }
      const color = base.clone();
      if (planet.kind === 'gas') {
        const bands = Math.sin(lat * 42 + noise * 2) * 0.5 + 0.5;
        color.lerp(light, bands * 0.4).multiplyScalar(0.65 + bands * 0.4);
      } else if (planet.kind === 'ocean') {
        if (noise > 0.05) color.lerp(land, 0.85).multiplyScalar(0.75 + noise * 0.25);
        else color.multiplyScalar(0.65 + noise * 0.2);
        const cloud = Math.sin(a * 11 + b * 9 + phases[15]) * Math.cos(c * 16 + phases[16]) + noise * 0.25;
        if (cloud > 0.6) color.lerp(light, (cloud - 0.6) * 1.2);
        if (Math.abs(c) > 0.93 + noise * 0.02) color.lerp(light, 0.88);
      } else if (planet.kind === 'lava') {
        color.multiplyScalar(0.28 + (noise + 1) * 0.2);
        if (Math.abs(noise) < 0.04) color.set('#ffb350');
      } else color.multiplyScalar(0.65 + (noise + 1) * 0.23);
      const pixel = (y * canvas.width + x) * 4;
      image.data[pixel] = Math.min(255, color.r * 255);
      image.data[pixel + 1] = Math.min(255, color.g * 255);
      image.data[pixel + 2] = Math.min(255, color.b * 255);
      image.data[pixel + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function atmosphere(radius, color) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 40, 24), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform vec3 tint; varying vec3 vNormal; varying vec3 vView; void main(){float a=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),3.);gl_FragColor=vec4(tint,a*.6);}'
  }));
}

function buildSystem() {
  clearWorld();
  state.planets = makeSystem(state.star);
  orbitGroup = new THREE.Group();
  world.add(orbitGroup);
  const starlight = new THREE.PointLight(state.star.color, 1000, 0, 1.3);
  world.add(starlight, new THREE.AmbientLight('#8194b4', 1.1));
  starSurface = new THREE.Mesh(new THREE.SphereGeometry(3.5, 48, 32), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(state.star.color) }, time: { value: 0 } },
    vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normal;vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 tint; uniform float time; varying vec3 vNormal; varying vec3 vPosition; void main(){float n=sin(vPosition.x*17.+sin(vPosition.y*9.+time))*sin(vPosition.z*14.+time*.3);gl_FragColor=vec4(tint*(1.+n*.18),1.);}'
  }));
  world.add(starSurface);
  world.add(sprite(state.star.color, 24, 0.65), sprite(state.star.color, 12, 0.55));
  starSurface.userData.select = () => selectCentralStar();
  pickables.push(starSurface);
  addLabel(state.star.name, starSurface, () => selectCentralStar(), { key: 'star', priority: 3 });
  state.planets.forEach((planet, index) => {
    const radius = visualRadius(planet);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshStandardMaterial({ map: surfaceTexture(planet), roughness: planet.kind === 'ocean' ? 0.65 : 0.95, metalness: 0, emissive: planet.kind === 'lava' ? '#62190b' : '#000000', emissiveIntensity: 0.5 }));
    group.add(mesh);
    if (['ocean', 'gas', 'ice'].includes(planet.kind)) group.add(atmosphere(radius, planet.color));
    if (planet.rings) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.4, radius * 2.2, 96), new THREE.MeshStandardMaterial({ color: '#b9a488', transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 1 }));
      ring.rotation.x = Math.PI / 2.3;
      group.add(ring);
      for (let band = 0; band < 4; band++) {
        const thin = new THREE.Mesh(new THREE.RingGeometry(radius * (1.5 + band * 0.17), radius * (1.54 + band * 0.17), 80), new THREE.MeshBasicMaterial({ color: '#1b2027', transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
        thin.rotation.copy(ring.rotation);
        group.add(thin);
      }
    }
    const moons = [];
    for (let i = 0; i < planet.moons; i++) {
      const moon = new THREE.Mesh(new THREE.SphereGeometry(radius * (i === 0 ? 0.17 : 0.09), 16, 12), new THREE.MeshStandardMaterial({ color: '#9b9d9f', roughness: 1 }));
      group.add(moon);
      moons.push(moon);
    }
    world.add(group);
    const linePoints = [];
    for (let i = 0; i < 200; i++) linePoints.push(new THREE.Vector3(...orbitPosition({ ...planet, phase: i / 200 * TAU }, 0, visualOrbit(index))));
    orbitGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: '#5e83ab', transparent: true, opacity: 0.21 })));
    mesh.userData.select = () => selectPlanet(planet);
    pickables.push(mesh);
    planetMeshes.push({ group, mesh, moons, planet, index });
    addLabel(planet.name.replace(state.star.name + ' ', ''), group, () => selectPlanet(planet), { key: index, priority: index === 2 ? 2 : 0 });
  });
  listItems = state.planets.map((planet) => ({ name: planet.name, subtitle: `${planetKinds[planet.kind]} · ${decimal.format(planet.au)} AU`, color: planet.color, type: 'planet', key: planet.id, real: planet.real, data: planet }));
  controls.minDistance = 2;
  controls.maxDistance = 330;
  entrance([20, 76, 104]);
  selectCentralStar();
  updateCelestialPositions();
}

function facts(items) {
  $('object-facts').replaceChildren(...items.map(([name, value]) => {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = name;
    const dd = document.createElement('dd'); dd.textContent = value;
    wrap.append(dt, dd);
    return wrap;
  }));
}

function setObject({ name, code, kind, real, color, type, description, metrics, action, onTravel }) {
  $('object-name').textContent = name;
  $('object-code').textContent = code;
  $('object-kind').textContent = kind;
  $('object-badge').textContent = real ? '실제 천체 · 재구성' : '생성 천체';
  $('object-badge').classList.toggle('real', real);
  $('object-art').className = `object-art ${type}`;
  $('object-art').style.setProperty('--art-color', color);
  $('object-description').textContent = description;
  facts(metrics);
  $('travel-button').firstElementChild.textContent = action;
  $('travel-button').onclick = onTravel;
  $('travel-button').disabled = false;
  renderList();
  for (const label of labels) label.button.classList.toggle('selected', label.key === state.selected?.key);
}

function selectGalaxy(galaxy) {
  state.galaxy = galaxy;
  state.star = starAt(galaxy, 0);
  state.selected = { type: 'galaxy', key: galaxy.id };
  setObject({ name: galaxy.name, code: galaxy.code, kind: galaxy.kind, real: galaxy.real, color: '#b9ccea', type: 'galaxy',
    description: galaxy.description, metrics: [['항성계', '클릭하여 생성'], ['자료 구분', galaxy.real ? '실제 은하 기반' : '상상한 은하']],
    action: '은하 안으로', onTravel: () => navigate('galaxy') });
  updateRoute();
}

function selectStar(star) {
  state.star = star;
  state.selected = { type: 'star', key: star.id };
  addStarLabel(star);
  setObject({ name: star.name, code: star.code, kind: `${star.type}형 · ${star.label}`, real: star.real, color: star.color, type: 'star',
    metrics: [['표면 온도', `${decimal.format(star.temperature)} K`], ['항성 질량', `${star.mass} 태양질량`], ['행성', `${makeSystem(star).length}개`], ['소속 은하', state.galaxy.name]],
    description: star.real ? '우리의 출발점. 여덟 행성이 도는 태양계에서 탐험을 시작하세요.' : '처음 만나는 별입니다. 이 별 주위에는 어떤 세계가 있을까요?',
    action: '행성계 탐사', onTravel: () => navigate('system') });
  updateRoute();
}

function selectCentralStar() {
  follow = null;
  previousFollow = null;
  state.selected = { type: 'star', key: 'star' };
  const star = state.star;
  setObject({ name: star.name, code: star.code, kind: `${star.type}형 · ${star.label}`, real: star.real, color: star.color, type: 'star',
    metrics: [['표면 온도', `${decimal.format(star.temperature)} K`], ['행성', `${state.planets.length}개`], ['항성 질량', `${star.mass} 태양질량`], ['모형', '케플러 공전']],
    description: '행성을 선택해 가까이 다가가 보세요. 시간을 빠르게 돌리면 서로 다른 공전 주기가 보입니다.',
    action: '행성계 전체 보기', onTravel: () => { follow = null; moveCamera([20, 76, 104]); } });
  updateRoute();
}

function selectPlanet(planet, travel = false) {
  state.selected = { type: 'planet', key: planet.id };
  setObject({ name: planet.name, code: `${state.star.code} / ${String.fromCharCode(98 + planet.id).toUpperCase()}`, kind: planetKinds[planet.kind], real: planet.real, color: planet.color, type: 'planet',
    metrics: [['항성까지 거리', `${decimal.format(planet.au)} AU`], ['공전 주기', planet.period < 1000 ? `${readable(planet.period)}일` : `${readable(planet.period / 365.25)}년`], ['반지름', `${planet.radius} 지구반지름`], ['궤도 이심률', planet.eccentricity.toFixed(3)]],
    description: planet.real ? '기본 수치는 실제 행성 자료에 기반합니다. 표면 무늬와 시작 위치, 위성의 배치는 탐험용 표현입니다.' : '같은 주소에서 다시 만날 수 있는 행성. 표면과 위성은 이 세계를 위한 상상입니다.',
    action: '가까이 관찰하기', onTravel: () => approachPlanet(planet) });
  updateRoute();
  if (travel) approachPlanet(planet);
}

function approachPlanet(planet) {
  const entry = planetMeshes[planet.id];
  if (!entry) return;
  follow = null;
  const target = entry.group.position;
  const r = visualRadius(planet) * (planet.rings ? 2 : 1);
  // 항성 쪽에서 접근하면 행성의 낮 쪽과 밤의 경계가 함께 보인다.
  const sunward = target.clone().negate().normalize().multiplyScalar(r * 5.2);
  sunward.y = r * 2.2;
  const destination = target.clone().add(sunward);
  moveCamera(destination.toArray(), target.toArray(), 1100);
  animation.followAfter = entry.group;
  toast(`${planet.name}의 공전을 따라갑니다`);
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  const visible = listItems.filter((item) => `${item.name} ${item.subtitle}`.toLowerCase().includes(query));
  $('destination-list').replaceChildren();
  $('list-count').textContent = `${visible.length}개`;
  for (const item of visible) {
    const button = document.createElement('button');
    button.className = `destination${state.selected?.key === item.key ? ' selected' : ''}`;
    button.setAttribute('aria-label', `${item.name} 선택`);
    const thumb = document.createElement('span'); thumb.className = `thumb ${item.type}`; thumb.style.setProperty('--object-color', item.color);
    const content = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = item.name;
    const subtitle = document.createElement('small'); subtitle.textContent = item.subtitle;
    content.append(name, subtitle);
    const dot = document.createElement('span'); dot.className = `destination-dot${item.real ? ' real' : ''}`;
    button.append(thumb, content, dot);
    button.onclick = () => {
      if (state.view === 'cluster') selectGalaxy(item.data);
      else if (state.view === 'galaxy') selectStar(item.data);
      else selectPlanet(item.data);
      closeDrawer();
    };
    $('destination-list').append(button);
  }
  if (!visible.length) { const empty = document.createElement('p'); empty.textContent = '일치하는 천체가 없습니다.'; empty.style.cssText = 'font-size:11px;color:#8193ab;padding:20px 8px'; $('destination-list').append(empty); }
}

function updateHeadings() {
  const view = state.view;
  $('scene-title').replaceChildren(document.createTextNode(view === 'cluster' ? (state.sector === 0 ? '은하 너머로' : `미지의 구역 ${state.sector}`) : view === 'galaxy' ? state.galaxy.name : state.star.real ? '태양계' : state.star.name));
  const period = document.createElement('span'); period.textContent = '.'; $('scene-title').append(period);
  $('breadcrumb').textContent = view === 'cluster' ? (state.sector === 0 ? '국부은하군과 상상의 이웃' : `생성 우주 / 구역 ${state.sector}`) : view === 'galaxy' ? `은하 구역 ${state.sector} / ${state.galaxy.code}` : `${state.galaxy.name} / ${state.star.code}`;
  $('scene-subtitle').textContent = view === 'cluster' ? '하나의 은하를 넘어, 또 다른 세계로.' : view === 'galaxy' ? '익숙한 별에서, 아직 이름 없는 세계로.' : '작은 세계의 움직임에서, 우주의 시간을 발견하세요.';
  $('scene-count').textContent = view === 'cluster' ? `${galaxyCatalog.length}개의 은하 · 다음 구역으로 확장` : view === 'galaxy' ? `${STAR_COUNT.toLocaleString('ko-KR')}개의 별 · 모두 탐사 가능` : `${state.planets.length}개의 행성`;
  $('scene-model').textContent = view === 'system' ? '케플러 공전 · 거리 압축' : '회전 모형 · 공간 재구성';
  $('list-title').textContent = view === 'cluster' ? '은하 목록' : view === 'galaxy' ? '추천 항성' : '행성 목록';
  $('up-button').textContent = view === 'system' ? '↖ 은하 탐사로' : view === 'galaxy' ? '↖ 은하 지도로' : '↖ 첫 번째 은하 구역';
  $('up-button').disabled = view === 'cluster' && state.sector === 0;
  $('discover-label').textContent = view === 'cluster' ? '다음 은하 구역으로' : '미지의 별로 떠나기';
  $('sector-code').textContent = `구역 ${String(state.sector).padStart(3, '0')}`;
  $('scale-level').textContent = view === 'cluster' ? '은하와 은하 사이' : view === 'galaxy' ? '은하 규모' : '행성계 규모';
  $('orbit-button').disabled = view === 'cluster';
  document.querySelectorAll('[data-view]').forEach((button) => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
}

function navigate(view, fromHistory = false) {
  rebuilding = true;
  state.view = view;
  $('search').value = '';
  state.speed = 3;
  $('speed-slider').value = state.speed;
  if (view === 'cluster') buildCluster();
  else if (view === 'galaxy') buildGalaxy();
  else buildSystem();
  if (orbitGroup) orbitGroup.visible = state.orbits;
  updateHeadings();
  updateTimeUI();
  closeDrawer();
  rebuilding = false;
  updateRoute(fromHistory);
}

function updateRoute(replace = true) {
  if (rebuilding || !state.galaxy || !state.star) return;
  const params = new URLSearchParams({ view: state.view, sector: state.sector, galaxy: state.galaxy.id, star: state.star.id });
  if (state.view === 'system' && state.selected?.type === 'planet') params.set('planet', state.selected.key);
  const next = `#${params}`;
  if (location.hash !== next) history[replace ? 'replaceState' : 'pushState'](null, '', next);
}

function parseRoute() {
  const params = new URLSearchParams(location.hash.slice(1));
  const sector = Number(params.get('sector') || 0);
  state.sector = Number.isSafeInteger(sector) && sector >= 0 && sector < 1e9 ? sector : 0;
  galaxyCatalog = galaxiesInSector(state.sector);
  state.galaxy = galaxyCatalog.find((galaxy) => galaxy.id === params.get('galaxy')) || galaxyCatalog[0];
  const index = Number(params.get('star') || 0);
  state.star = starAt(state.galaxy, Number.isInteger(index) && index >= 0 && index < STAR_COUNT ? index : 0);
  const view = ['cluster', 'galaxy', 'system'].includes(params.get('view')) ? params.get('view') : 'galaxy';
  const selectedPlanet = params.has('planet') ? Number(params.get('planet')) : -1;
  navigate(view, true);
  if (view === 'system' && Number.isInteger(selectedPlanet) && state.planets[selectedPlanet]) selectPlanet(state.planets[selectedPlanet]);
}

function updateTimeUI() {
  const speed = speeds[state.view][state.speed];
  const unit = state.view === 'system' ? '일' : '년';
  const amount = state.view === 'system' ? speed * 365.25 : speed;
  $('speed-label').textContent = `${state.direction < 0 ? '−' : ''}${readable(amount, 2)}${unit} / 초`;
  const abs = Math.abs(state.years);
  $('elapsed').textContent = abs < 0.00001 ? '기준 시점' : abs < 1 ? `${state.years < 0 ? '−' : '+'}${readable(abs * 365.25, 1)}일` : `${state.years < 0 ? '−' : '+'}${readable(abs, 2)}년`;
  $('pause-button').textContent = state.paused ? '▶' : 'Ⅱ';
  $('pause-button').setAttribute('aria-label', state.paused ? '시간 재생' : '시간 정지');
  $('reverse-button').setAttribute('aria-pressed', String(state.direction < 0));
  $('reverse-button').setAttribute('aria-label', state.direction < 0 ? '시간 정방향 재생' : '시간 역재생');
  $('live-status').lastChild.textContent = state.paused ? '시간 정지됨' : state.direction < 0 ? '시간 역재생 중' : '시간 진행 중';
}

function updateCelestialPositions() {
  if (galaxyGroup) galaxyGroup.rotation.y = state.years / 220e6 * TAU;
  if (state.view === 'cluster') {
    for (const child of world.children) child.rotation.y = child.userData.baseRotationY + state.years / 220e6 * TAU;
  }
  for (const entry of planetMeshes) {
    entry.group.position.set(...orbitPosition(entry.planet, state.years, visualOrbit(entry.index)));
    entry.mesh.rotation.y = ((state.years * 365.25 % Math.abs(entry.planet.day)) / entry.planet.day) * TAU;
    entry.moons.forEach((moon, index) => {
      const angle = state.years * 365.25 / (12 + index * 15) * TAU + index * 1.8;
      const r = visualRadius(entry.planet) * (2.7 + index * 0.55);
      moon.position.set(Math.cos(angle) * r, Math.sin(angle * 0.7) * r * 0.15, Math.sin(angle) * r);
    });
  }
  if (starSurface) starSurface.material.uniforms.time.value = (state.years * 365.25 % 10000) * 0.03;
}

function projectLabels() {
  const rects = [];
  const width = innerWidth, height = innerHeight;
  for (const label of [...labels].sort((a, b) => (b.button.classList.contains('selected') ? 10 : b.priority) - (a.button.classList.contains('selected') ? 10 : a.priority))) {
    label.object.getWorldPosition(vector);
    vector.project(camera);
    const x = (vector.x * 0.5 + 0.5) * width, y = (-vector.y * 0.5 + 0.5) * height;
    const w = Math.min(180, label.button.textContent.length * 9 + 30);
    const rect = { x: x - w / 2, y: y - 14, w, h: 28 };
    const out = vector.z > 1 || vector.z < -1 || x < 10 || x > width - 10 || y < 86 || y > height - 130;
    const overlap = rects.some((r) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y);
    const visible = !out && !overlap;
    label.button.style.display = visible ? 'flex' : 'none';
    if (visible) { label.button.style.left = `${x}px`; label.button.style.top = `${y}px`; rects.push(rect); }
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - (lastFrame || now)) / 1000, 0.06);
  lastFrame = now;
  if (!state.paused && !document.hidden) state.years += dt * speeds[state.view][state.speed] * state.direction;
  updateCelestialPositions();
  if (animation) {
    if (animation.followAfter) {
      const delta = animation.followAfter.position.clone().sub(animation.toTarget);
      animation.to.add(delta);
      animation.toTarget.add(delta);
    }
    const t = animation.duration ? Math.min(1, (now - animation.start) / animation.duration) : 1;
    const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    camera.position.lerpVectors(animation.from, animation.to, ease);
    controls.target.lerpVectors(animation.fromTarget, animation.toTarget, ease);
    if (t === 1) {
      follow = animation.followAfter || null;
      previousFollow = follow?.position.clone() || null;
      animation = null;
      controls.enabled = true;
    }
  } else if (follow) {
    const delta = follow.position.clone().sub(previousFollow);
    camera.position.add(delta);
    controls.target.add(delta);
    previousFollow.copy(follow.position);
  }
  controls.update();
  background.position.copy(camera.position);
  renderer.render(scene, camera);
  projectLabels();
  if (now - lastUI > 150) { updateTimeUI(); lastUI = now; }
}

function closeDrawer() { $('destinations').classList.remove('open'); $('drawer-button').setAttribute('aria-expanded', 'false'); }
function goUp() {
  if (state.view === 'system') navigate('galaxy');
  else if (state.view === 'galaxy') navigate('cluster');
  else { state.sector = 0; state.galaxy = galaxiesInSector(0)[0]; state.star = starAt(state.galaxy, 0); navigate('cluster'); }
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => navigate(button.dataset.view));
  $('search').oninput = renderList;
  $('up-button').onclick = goUp;
  $('discover-button').onclick = () => {
    if (state.view === 'cluster') {
      state.sector++;
      state.galaxy = galaxiesInSector(state.sector)[0]; state.star = starAt(state.galaxy, 0);
      navigate('cluster');
      toast(`새로운 은하 구역 ${state.sector}에 도착했습니다`);
    } else {
      const bytes = crypto.getRandomValues(new Uint32Array(1));
      state.star = starAt(state.galaxy, 1 + bytes[0] % (STAR_COUNT - 1));
      navigate('system');
      toast('미지의 항성계에 도착했습니다');
    }
  };
  $('pause-button').onclick = () => { state.paused = !state.paused; updateTimeUI(); };
  $('reverse-button').onclick = () => { state.direction *= -1; updateTimeUI(); };
  $('speed-slider').oninput = (event) => { state.speed = Number(event.target.value); updateTimeUI(); };
  $('reset-time').onclick = () => { state.years = 0; updateCelestialPositions(); updateTimeUI(); toast('기준 시점으로 돌아왔습니다'); };
  $('orbit-button').onclick = () => {
    state.orbits = !state.orbits;
    if (orbitGroup) orbitGroup.visible = state.orbits;
    $('orbit-button').setAttribute('aria-pressed', String(state.orbits));
  };
  $('drawer-button').onclick = () => { const open = $('destinations').classList.toggle('open'); $('drawer-button').setAttribute('aria-expanded', String(open)); };
  $('help-button').onclick = () => $('help-dialog').showModal();
  $('close-help').onclick = () => $('help-dialog').close();
  $('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) { const r = $('help-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('help-dialog').close(); } });
  if (!document.documentElement.requestFullscreen) $('fullscreen-button').hidden = true;
  $('fullscreen-button').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { toast('이 브라우저에서는 전체 화면을 사용할 수 없습니다'); }
  };
  document.querySelector('.brand').onclick = (event) => { event.preventDefault(); state.sector = 0; state.galaxy = galaxiesInSector()[0]; state.star = starAt(state.galaxy, 0); navigate('galaxy'); };
  addEventListener('keydown', (event) => {
    if (event.target.matches('input,button,select') || $('help-dialog').open) return;
    if (event.code === 'Space') { event.preventDefault(); state.paused = !state.paused; updateTimeUI(); }
    if (event.code === 'Escape') { closeDrawer(); goUp(); }
  });
  addEventListener('hashchange', parseRoute);
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY, id: event.pointerId }; closeDrawer(); });
  renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!down || down.id !== event.pointerId || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || animation) return;
    down = null;
    pointer.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points.threshold = Math.max(0.35, camera.position.distanceTo(controls.target) * 0.0025);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return;
    const hit = hits[0];
    if (hit.object.userData.galaxyStars && hit.index !== undefined) selectStar(starAt(state.galaxy, hit.index));
    else hit.object.userData.select?.();
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); showError('그래픽 연결이 중단되었습니다. 화면을 다시 열어 주세요.'); });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}

function showError(message) { $('error-message').textContent = message; $('error-panel').hidden = false; $('loading').classList.add('done'); }

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor('#04070d');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  $('viewport').append(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(49, innerWidth / innerHeight, 0.05, 9000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.8;
  glow = glowTexture();
  createBackground();
  parseRoute();
  bindEvents();
  renderer.render(scene, camera);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 800);
  requestAnimationFrame(animate);
} catch (error) {
  console.error(error);
  showError('3D 그래픽을 시작하지 못했습니다. WebGL 2를 지원하는 브라우저에서 하드웨어 가속을 켜고 다시 시도해 주세요.');
}
