import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STAR_COUNT, TAU, hash, random, galaxiesInSector, starAt, makeSystem, orbitPosition, visualOrbit, visualRadius, planetKinds, blackHoleIn } from './universe.js?v=3';
import { createStarVisual, createBlackHoleVisual, createBlackHoleBackground, updateObjectVisual } from './objects.js?v=7';
import { DETAIL_SCALE, remapCamera, zoomBoundary } from './navigation.js?v=3';
import { loadSkyCatalog, createSkyMode } from './sky.js?v=3';
import { OBSERVERS, SKY_RATES, tonight, localDateInput, dateFromLocal } from './sky-math.js?v=3';
import { createTapTracker } from './tap.js?v=4';
import { solarMapFor } from './planet-maps.js?v=4';
import { createPlanetVisual, STARLIGHT_INTENSITY } from './planet-visual.js?v=7';
import { createOpticalRenderer } from './optical-renderer.js?v=7';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { view: 'galaxy', sector: 0, galaxy: null, star: null, planets: [], selected: null, years: 0, paused: false, direction: 1, speed: 3, orbits: true };
const speeds = { galaxy: [1e3, 1e4, 1e5, 1e6, 1e7, 5e7, 1e8], cluster: [1e3, 1e4, 1e5, 1e6, 1e7, 5e7, 1e8], system: [0.01, 0.1, 1, 10, 100, 1000, 10000].map((days) => days / 365.25) };
speeds.blackhole = [0.0001, 0.001, 0.01, 0.1, 1, 10, 100].map((days) => days / 365.25);
let renderer, opticalRenderer, scene, camera, controls, world, galaxyGroup, orbitGroup, background, backgroundMap;
let labels = [], pickables = [], planetMeshes = [], starSurface, animation = null, follow = null, previousFollow = null;
let listItems = [], galaxyCatalog = galaxiesInSector(), lastFrame = 0, lastUI = 0, toastTimer, rebuilding = false;
let preview = null, systemRoot = null, detailVisual = null, galaxyBlackHole = null, galaxyBackdrop = null;
let focusTarget = null, scaleChanging = false, zoomUntil = 0, zoomDirection = 0, previousDistance = 0, zoomCooldown = 0;
let viewEpoch = 0;
let skyCatalog = null, skyMode = null, skyConfig = null, skySelection = null, lastSpaceHash = '', spacePaused = false, lastSkyFacts = 0, lastSkyList = 0;
const clusterGroups = new Map();
const galaxyData = new Map();
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

function pointCloud(positions, colors, size, opacity = 1, maximumSize = 6) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size, map: glow, transparent: true, vertexColors: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  material.onBeforeCompile = (shader) => { shader.vertexShader = shader.vertexShader.replace('#include <logdepthbuf_vertex>', `#include <logdepthbuf_vertex>\ngl_PointSize = min(gl_PointSize, ${maximumSize.toFixed(1)});`); };
  material.customProgramCacheKey = () => `astra-points-${maximumSize}`;
  return new THREE.Points(geometry, material);
}

function createGalaxy(galaxy, count, radius) {
  const group = new THREE.Group();
  let data = galaxyData.get(galaxy.id);
  if (!data) {
  const positions = [], colors = [], dustPositions = [], dustColors = [];
  const tint = new THREE.Color();
  for (let index = 0; index < count; index++) {
    const star = starAt(galaxy, index);
    const r = Math.hypot(star.position[0], star.position[2]);
    positions.push(...star.position);
    tint.set(star.color);
    if (r < 25) tint.lerp(new THREE.Color('#ffd5a3'), 0.65);
    else tint.lerp(new THREE.Color().setHSL(galaxy.hue, 0.55, 0.7), 0.35);
    colors.push(tint.r, tint.g, tint.b);
    if (index % 7 === 0) {
      dustPositions.push(...star.position);
      tint.setHSL(galaxy.hue + 0.015 * Math.sin(index), 0.6, r < 30 ? 0.5 : 0.4);
      if (r < 25) tint.set('#a08163');
      dustColors.push(tint.r, tint.g, tint.b);
    }
  }
  data = [positions, colors, dustPositions, dustColors].map((values) => new Float32Array(values));
  if (galaxyData.size >= 16) galaxyData.delete(galaxyData.keys().next().value);
  galaxyData.set(galaxy.id, data);
  }
  const stars = pointCloud(data[0], data[1], 1.3, 0.9);
  group.add(stars);
  const dust = pointCloud(data[2], data[3], 21, 0.12, 96);
  group.add(dust);
  const core = sprite('#e7c4a0', 75, 0.9);
  core.scale.y *= 0.8;
  group.add(core);
  group.add(sprite('#ffdcac', 22.5, 0.8));
  group.userData.stars = stars;
  group.userData.dust = dust;
  group.userData.core = core;
  setGalaxyScale(group, radius / 150);
  return group;
}

function setGalaxyScale(group, scale) {
  group.scale.setScalar(scale);
  group.userData.stars.material.size = 1.3 * scale;
  group.userData.dust.material.size = 21 * scale;
}

function orientGalaxy(group, galaxy) {
  group.rotation.set(0.15 + (hash(galaxy.id) % 8) * 0.09, (hash(galaxy.id) % 7) * 0.3 + state.years / 220e6 * TAU, 0.1);
  group.userData.baseRotationY = (hash(galaxy.id) % 7) * 0.3;
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
  backgroundMap = createBlackHoleBackground(positions, colors);
  background = pointCloud(positions, colors, 5, 0.8);
  scene.add(background);
}

function disposeWorld(root = world) {
  if (!root) return;
  const textures = new Set();
  root.traverse((object) => {
    object.geometry?.dispose();
    for (const material of [object.material].flat().filter(Boolean)) {
      for (const texture of [material.map, material.normalMap, material.specularMap, material.alphaMap, material.emissiveMap, material.bumpMap, ...Object.values(material.uniforms || {}).map((uniform) => uniform.value)]) if (texture?.isTexture && texture !== glow && texture !== backgroundMap) textures.add(texture);
      material.dispose();
    }
  });
  textures.forEach((texture) => texture.dispose());
  scene.remove(root);
}

function clearWorld() {
  if (skyMode) { skyConfig = { observer: skyMode.state.observer, date: new Date(skyMode.state.time) }; skyMode.dispose(); skyMode = null; }
  document.body.classList.remove('sky-mode');
  $('sky-controls').hidden = true;
  $('sky-button').textContent = '✧ 지구 하늘';
  $('sky-button').setAttribute('aria-pressed', 'false');
  $('drawer-button').textContent = '☷ 목적지';
  $('time-caption').textContent = '관측 경과 시간';
  $('discover-button').hidden = false;
  controls.enabled = true;
  background.visible = true;
  camera.fov = 49;
  camera.updateProjectionMatrix();
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
  systemRoot = null;
  detailVisual = null;
  galaxyBlackHole = null;
  galaxyBackdrop = null;
  preview = null;
  focusTarget = null;
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
  // 포인터 선택은 이동 거리 검사 뒤 처리하고 키보드·접근성 클릭은 유지한다.
  button.addEventListener('click', (event) => { if (event.detail === 0) onClick(); });
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

function entrance(position, target = [0, 0, 0]) {
  if (scaleChanging) return;
  camera.up.set(0, 1, 0);
  controls.target.set(...target);
  camera.position.set(...position.map((value, i) => target[i] + (value - target[i]) * 1.13));
  controls.update();
  moveCamera(position, target, 1200);
  $('warp').classList.remove('active');
  void $('warp').offsetWidth;
  $('warp').classList.add('active');
}

function buildCluster(carried = null) {
  clearWorld();
  clusterGroups.clear();
  galaxyCatalog = galaxiesInSector(state.sector);
  for (const galaxy of galaxyCatalog) {
    const mesh = carried && galaxy.id === state.galaxy.id ? carried : createGalaxy(galaxy, STAR_COUNT, galaxy.size);
    mesh.position.set(...galaxy.position);
    setGalaxyScale(mesh, galaxy.size / 150);
    if (mesh === carried) mesh.userData.baseRotationY = mesh.rotation.y - state.years / 220e6 * TAU;
    else orientGalaxy(mesh, galaxy);
    world.add(mesh);
    clusterGroups.set(galaxy.id, mesh);
    mesh.userData.stars.userData.galaxyStars = false;
    mesh.userData.stars.userData.select = () => selectGalaxy(galaxy);
    pickables.push(mesh.userData.stars);
    addLabel(galaxy.name, mesh, () => selectGalaxy(galaxy), { key: galaxy.id, caption: galaxy.real ? galaxy.code : '미지의 은하', priority: galaxy.id === state.galaxy.id ? 2 : 0 });
  }
  controls.minDistance = 0.1;
  controls.maxDistance = 3500;
  entrance([40, 470, 740]);
  listItems = galaxyCatalog.map((data) => ({ name: data.name, subtitle: data.kind, color: '#b5ccf0', type: 'galaxy', key: data.id, real: data.real, data }));
  selectGalaxy(galaxyCatalog.find((g) => g.id === state.galaxy.id) || galaxyCatalog[0]);
}

function buildGalaxy(carried = null, carriedDetail = null) {
  const wantsBlackHole = state.selected?.type === 'blackhole' || state.view === 'blackhole';
  clearWorld();
  galaxyGroup = carried || createGalaxy(state.galaxy, STAR_COUNT, 150);
  galaxyGroup.position.set(0, 0, 0);
  setGalaxyScale(galaxyGroup, 1);
  if (carried) galaxyGroup.userData.baseRotationY = galaxyGroup.rotation.y - state.years / 220e6 * TAU;
  else orientGalaxy(galaxyGroup, state.galaxy);
  world.add(galaxyGroup);
  galaxyGroup.userData.stars.userData.galaxyStars = true;
  pickables.push(galaxyGroup.userData.stars);
  galaxyBlackHole = carriedDetail?.kind === 'blackhole' ? carriedDetail.root : galaxyGroup.userData.blackHole || createBlackHoleVisual(backgroundMap);
  galaxyBlackHole.position.set(0, 0, 0);
  galaxyBlackHole.quaternion.identity();
  galaxyBlackHole.scale.setScalar(DETAIL_SCALE);
  galaxyGroup.add(galaxyBlackHole);
  galaxyGroup.userData.blackHole = galaxyBlackHole;
  const hole = blackHoleIn(state.galaxy);
  addLabel(hole.name, galaxyBlackHole, () => selectBlackHole(), { key: 'blackhole', caption: '블랙홀', priority: 2 });
  galaxyBlackHole.userData.surface.userData.select = () => selectBlackHole();
  pickables.push(galaxyBlackHole.userData.surface);
  preview = carriedDetail?.kind === 'system' ? carriedDetail : galaxyGroup.userData.preview || null;
  orbitGroup = new THREE.Group();
  const ringPoints = [];
  for (let i = 0; i < 160; i++) { const a = i / 160 * TAU; ringPoints.push(new THREE.Vector3(Math.cos(a) * 166, 0, Math.sin(a) * 166)); }
  orbitGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color: '#5a789d', transparent: true, opacity: 0.13 })));
  world.add(orbitGroup);
  const indices = [0, ...Array.from({ length: 21 }, (_, i) => 17 + (hash(state.galaxy.id) + i * 929) % (STAR_COUNT - 30))];
  if (!indices.includes(state.star.id)) indices.push(state.star.id);
  listItems = [{ name: hole.name, subtitle: '중심 블랙홀', color: '#e7a15e', type: 'blackhole', key: 'blackhole', real: hole.real, data: hole }, ...indices.map((index) => {
    const star = starAt(state.galaxy, index);
    return { name: star.name, subtitle: `${star.type}형 · ${star.label}`, color: star.color, type: 'star', key: star.id, real: star.real, data: star };
  })];
  for (const item of listItems.slice(1, 8)) addStarLabel(item.data);
  controls.minDistance = 0.1;
  controls.maxDistance = 1600;
  galaxyGroup.updateMatrixWorld(true);
  const center = wantsBlackHole ? new THREE.Vector3() : new THREE.Vector3(...state.star.position).applyMatrix4(galaxyGroup.matrixWorld);
  entrance(center.clone().add(new THREE.Vector3(25, 205, 310)).toArray(), center.toArray());
  if (wantsBlackHole) selectBlackHole();
  else selectStar(state.star);
}

function addStarLabel(star) {
  const existing = labels.find((label) => label.key === star.id);
  if (existing) return existing;
  const anchor = new THREE.Object3D();
  anchor.position.set(...star.position);
  galaxyGroup.add(anchor);
  return addLabel(star.name, anchor, () => selectStar(star), { key: star.id, selected: star.id === state.star.id, priority: star.id === state.star.id ? 3 : 0 });
}

function surfaceTexture(planet) {
  const map = solarMapFor(planet);
  if (map) {
    const texture = new THREE.TextureLoader().load(new URL(`../data/planets/${map.file}`, import.meta.url).href, undefined, undefined, () => toast(`${planet.name} 지도를 불러오지 못했습니다. 화면을 다시 열어 주세요.`));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  const rng = random(planet.seed);
  const phases = Array.from({ length: 18 }, () => rng() * TAU);
  const base = new THREE.Color(planet.color);
  const land = new THREE.Color(planet.kind === 'ocean' ? '#72896b' : '#b29a7e');
  const light = new THREE.Color('#e8e3d3');
  const encoded = new THREE.Color();
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
        const bands = Math.sin(lat * 42 + Math.sin(lon * 3 + phases[0]) * .7 + noise * 4) * 0.5 + 0.5;
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
      color.getRGB(encoded, THREE.SRGBColorSpace);
      image.data[pixel] = Math.min(255, encoded.r * 255);
      image.data[pixel + 1] = Math.min(255, encoded.g * 255);
      image.data[pixel + 2] = Math.min(255, encoded.b * 255);
      image.data[pixel + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function createSystemGraph(star) {
  const root = new THREE.Group(), orbits = new THREE.Group(), entries = [];
  const planets = makeSystem(star);
  const starlight = new THREE.PointLight(new THREE.Color(star.color).lerp(new THREE.Color('#ffffff'), .75), STARLIGHT_INTENSITY, 0, 0);
  const visual = createStarVisual(star, glow);
  root.add(orbits, starlight, new THREE.AmbientLight('#b9c6dd', .055), visual);
  planets.forEach((planet, index) => {
    const radius = visualRadius(planet);
    const group = new THREE.Group();
    const { root: visualRoot, mesh } = createPlanetVisual({ planet, radius, surface: surfaceTexture(planet), light: starlight, anisotropy: Math.min(4, renderer.capabilities.getMaxAnisotropy()) });
    group.add(visualRoot);
    const moons = [];
    for (let i = 0; i < planet.moons; i++) {
      const moon = new THREE.Mesh(new THREE.SphereGeometry(radius * (i === 0 ? 0.17 : 0.09), 16, 12), new THREE.MeshStandardMaterial({ color: '#9b9d9f', roughness: 1 }));
      group.add(moon);
      moons.push(moon);
    }
    root.add(group);
    const linePoints = [];
    for (let i = 0; i < 200; i++) linePoints.push(new THREE.Vector3(...orbitPosition({ ...planet, phase: i / 200 * TAU }, 0, visualOrbit(index))));
    orbits.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: '#5e83ab', transparent: true, opacity: 0.21 })));
    entries.push({ group, mesh, moons, planet, index });
  });
  return { root, planets, entries, orbits, visual, starlight, seed: star.seed, kind: 'system' };
}

function attachPreview(graph) {
  graph.root.position.set(...state.star.position);
  graph.root.quaternion.identity();
  graph.root.scale.setScalar(DETAIL_SCALE);
  graph.starlight.intensity = STARLIGHT_INTENSITY;
  graph.orbits.visible = state.orbits;
  galaxyGroup.add(graph.root);
  galaxyGroup.userData.preview = graph;
  planetMeshes = graph.entries;
  detailVisual = graph.visual;
}

function ensurePreview() {
  if (preview?.seed !== state.star.seed) {
    if (preview) {
      disposeWorld(preview.root);
      preview.root.removeFromParent();
    }
    preview = createSystemGraph(state.star);
  }
  attachPreview(preview);
}

function buildSystem(carried = null, backdrop = null) {
  clearWorld();
  const graph = carried || createSystemGraph(state.star);
  graph.root.position.set(0, 0, 0);
  graph.root.quaternion.copy(carried?.orientation || new THREE.Quaternion());
  graph.root.scale.setScalar(1);
  graph.starlight.intensity = STARLIGHT_INTENSITY;
  state.planets = graph.planets;
  planetMeshes = graph.entries;
  orbitGroup = graph.orbits;
  systemRoot = graph.root;
  preview = graph;
  detailVisual = graph.visual;
  world.add(systemRoot);
  if (backdrop) { galaxyBackdrop = backdrop; world.add(backdrop); }
  starSurface = graph.visual.userData.surface;
  starSurface.userData.select = () => selectCentralStar();
  pickables.push(starSurface);
  addLabel(state.star.name, starSurface, () => selectCentralStar(), { key: 'star', priority: 3 });
  for (const entry of planetMeshes) {
    entry.mesh.userData.select = () => selectPlanet(entry.planet);
    pickables.push(entry.mesh);
    addLabel(entry.planet.name.replace(state.star.name + ' ', ''), entry.group, () => selectPlanet(entry.planet), { key: entry.index, priority: entry.index === 2 ? 2 : 0 });
  }
  listItems = state.planets.map((planet) => ({ name: planet.name, subtitle: `${planetKinds[planet.kind]} · ${decimal.format(planet.au)} AU`, color: planet.color, type: 'planet', key: planet.id, real: planet.real, data: planet }));
  controls.minDistance = graph.visual.userData.radius * 1.15;
  controls.maxDistance = 800;
  entrance([20, 76, 104]);
  selectCentralStar();
  updateCelestialPositions();
}

function buildBlackHole(carried = null, backdrop = null) {
  clearWorld();
  systemRoot = carried?.root || createBlackHoleVisual(backgroundMap);
  systemRoot.position.set(0, 0, 0);
  systemRoot.quaternion.copy(carried?.orientation || new THREE.Quaternion());
  systemRoot.scale.setScalar(1);
  detailVisual = systemRoot;
  world.add(systemRoot);
  if (backdrop) { galaxyBackdrop = backdrop; world.add(backdrop); }
  state.planets = [];
  listItems = [{ name: blackHoleIn(state.galaxy).name, subtitle: '블랙홀 · 강착원반', color: '#f6af5c', type: 'blackhole', key: 'blackhole', data: blackHoleIn(state.galaxy), real: blackHoleIn(state.galaxy).real }];
  controls.minDistance = 9;
  controls.maxDistance = 800;
  const framing = Math.max(1, 1 / camera.aspect);
  entrance([0, 14 * framing, 47 * framing]);
  selectBlackHole();
}

async function openEarthSky(fromRoute = false) {
  if (state.view === 'sky') { goUp(); return; }
  $('sky-button').disabled = true;
  $('sky-button').textContent = '하늘 여는 중…';
  try {
    skyCatalog = await loadSkyCatalog();
    if (!fromRoute) { lastSpaceHash = location.hash; spacePaused = state.paused; }
    skyConfig ||= { observer: OBSERVERS[0], date: tonight(OBSERVERS[0]) };
    navigate('sky', fromRoute);
  } catch { toast('별자리 자료를 불러오지 못했습니다. 다시 시도해 주세요.'); }
  finally { $('sky-button').disabled = false; if (state.view !== 'sky') $('sky-button').textContent = '✧ 지구 하늘'; }
}

function buildSky() {
  const config = skyConfig || { observer: OBSERVERS[0], date: tonight(OBSERVERS[0]) };
  clearWorld();
  skyConfig = config;
  document.body.classList.add('sky-mode');
  $('sky-controls').hidden = false;
  $('discover-button').hidden = true;
  $('sky-button').textContent = '↗ 우주로';
  $('sky-button').setAttribute('aria-pressed', 'true');
  $('drawer-button').textContent = '☷ 관측 설정';
  $('time-caption').textContent = '관측 시각';
  controls.enabled = false;
  background.visible = false;
  skyMode = createSkyMode(skyCatalog, camera, renderer.domElement, { ...config, pixelRatio: renderer.getPixelRatio(), onStar: selectSkyStar });
  world.add(skyMode.root);
  for (const { constellation, object } of skyMode.anchors) addLabel(constellation.name, object, () => selectSkyConstellation(constellation), { key: `sky:${constellation.id}`, priority: 4 - constellation.rank });
  for (const { name, object } of skyMode.directions) addLabel(name, object, () => {}, { key: `direction:${name}`, priority: 5 });
  state.speed = 2;
  state.direction = 1;
  state.paused = true;
  $('speed-slider').value = 2;
  if (!$('sky-place').options.length) for (const observer of OBSERVERS) $('sky-place').add(new Option(observer.name, observer.id));
  $('sky-lines').checked = true;
  $('sky-names').checked = true;
  updateSkyControls();
  updateSkyList();
  const recommended = skyMode.recommend();
  if (recommended) selectSkyConstellation(recommended);
  lastSkyFacts = 0;
}

function skyMetrics(selection) {
  if (selection.type === 'constellation') {
    const at = skyMode.coordinates(...selection.data.center);
    return [['중심 고도', `${at.altitude.toFixed(1)}°`], ['방위각', `${at.azimuth.toFixed(1)}°`], ['관측 장소', skyMode.state.observer.name], ['자료', '실제 별 좌표']];
  }
  const star = selection.data;
  const at = skyMode.coordinates(star[1], star[2]);
  return [['겉보기 등급', decimal.format(star[3])], ['고도', `${at.altitude.toFixed(1)}°`], ['방위각', `${at.azimuth.toFixed(1)}°`], ['식별 번호', `HIP ${star[0]}`]];
}

function selectSkyConstellation(entry) {
  skySelection = { type: 'constellation', data: entry };
  state.selected = { type: 'constellation', key: `sky:${entry.id}` };
  const above = skyMode.focus(...entry.center);
  setObject({ name: entry.name, code: entry.id, kind: `별자리 · ${entry.latin}`, real: true, color: '#9bbfea', type: 'galaxy',
    metrics: skyMetrics(skySelection), description: '선택한 장소와 시각에서 본 실제 별의 배치입니다. 중심이 지평선 아래라면 시각이나 장소를 바꿔 보세요. 별자리 선과 이름을 각각 끌 수 있어요.',
    action: above ? '가운데 놓기' : '중심이 지평선 아래', onTravel: () => skyMode.focus(...entry.center) });
  $('object-badge').textContent = '실제 별 좌표';
  $('travel-button').disabled = !above;
}

function selectSkyStar(star) {
  skySelection = { type: 'star', data: star };
  state.selected = { type: 'sky-star', key: 'sky-star' };
  const name = star[5] || `HIP ${star[0]}`;
  const previous = labels.find((label) => label.key === 'sky-star');
  if (previous) { previous.button.remove(); labels = labels.filter((label) => label !== previous); }
  addLabel(name, skyMode.markStar(star), () => {}, { key: 'sky-star', selected: true, priority: 6 });
  setObject({ name, code: `HIP ${star[0]}`, kind: '지구에서 관측한 실제 항성', real: true, color: '#e5e9f4', type: 'star', metrics: skyMetrics(skySelection),
    description: '겉보기 등급은 숫자가 작을수록 밝습니다. 별의 위치와 밝기는 XHIP 관측 자료를 바탕으로 표시합니다.', action: '가운데 놓기', onTravel: () => skyMode.focus(star[1], star[2]) });
  $('object-badge').textContent = '실제 별 좌표';
}

function updateSkyList() {
  listItems = skyCatalog.constellations.map((entry) => {
    const altitude = skyMode.coordinates(...entry.center).altitude;
    return { name: entry.name, subtitle: `${entry.latin} · 중심 ${altitude < 0 ? '지평선 아래' : `고도 ${altitude.toFixed(0)}°`}`, color: '#a1c5e7', type: 'constellation', key: `sky:${entry.id}`, real: true, data: entry, above: altitude >= 0 };
  }).sort((a, b) => Number(b.above) - Number(a.above) || a.name.localeCompare(b.name, 'ko'));
  renderList();
  lastSkyList = performance.now();
}

function updateSkyControls() {
  const observer = skyMode.state.observer;
  $('sky-place').value = observer.id;
  $('sky-custom').hidden = observer.id !== 'custom';
  $('sky-latitude').value = observer.latitude;
  $('sky-longitude').value = observer.longitude;
  $('sky-timezone').textContent = observer.id === 'custom' ? '관측 시각 · 세계시(UTC)' : `관측 시각 · ${observer.name} 현지 시간`;
  $('sky-datetime').value = localDateInput(new Date(skyMode.state.time), observer.timezone);
}

function updateSkyHeadings() {
  const observer = skyMode.state.observer;
  $('scene-title').textContent = `${observer.id === 'custom' ? '지정한 위치' : observer.name}의 밤하늘`;
  $('breadcrumb').textContent = `지구 관측 / ${observer.latitude < 0 ? '남위' : '북위'} ${Math.abs(observer.latitude).toFixed(2)}° · ${observer.longitude < 0 ? '서경' : '동경'} ${Math.abs(observer.longitude).toFixed(2)}°`;
  $('scene-subtitle').textContent = '실제 별의 위치에서 만나는 88개의 별자리.';
  $('touch-hint').textContent = '드래그로 하늘 보기 · 두 손가락 확대';
  $('scene-count').textContent = '실제 별 5,044개 · 별자리 88개';
  $('scene-model').textContent = '지평선 위의 별 · 밝기 강조';
  $('list-title').textContent = '별자리';
  $('sector-code').textContent = '지구 관측';
  $('up-button').textContent = '↖ 우주 탐사로';
  $('up-button').disabled = false;
  $('orbit-button').disabled = false;
  $('orbit-button').setAttribute('aria-label', '별자리 선 표시');
  $('orbit-button').title = '별자리 선 표시';
  $('reset-time').title = '서울의 오늘 밤 9시로 초기화';
  $('reset-time').setAttribute('aria-label', '서울·오늘 밤 9시로 초기화');
  $('orbit-button').setAttribute('aria-pressed', String(skyMode.state.lines));
  document.querySelectorAll('[data-view]').forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-current', 'false'); });
}

function updateSkyTimeUI() {
  if (!skyMode) return;
  const date = new Date(skyMode.state.time), observer = skyMode.state.observer;
  $('elapsed').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: observer.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  $('speed-label').textContent = `${state.direction < 0 ? '−' : ''}${readable(SKY_RATES[state.speed])}배`;
  $('pause-button').textContent = state.paused ? '▶' : 'Ⅱ';
  $('pause-button').setAttribute('aria-label', state.paused ? '시간 재생' : '시간 정지');
  $('reverse-button').setAttribute('aria-pressed', String(state.direction < 0));
  $('reverse-button').setAttribute('aria-label', state.direction < 0 ? '시간 정방향 재생' : '시간 역재생');
  $('live-status').lastChild.textContent = state.paused ? '관측 시각 고정' : '하늘 시간 진행 중';
  $('zoom-destination').textContent = '하늘 확대';
  $('zoom-return').textContent = '드래그로 둘러보기';
  $('scale-level').textContent = `시야 ${camera.fov.toFixed(0)}°`;
  if (document.activeElement !== $('sky-datetime')) $('sky-datetime').value = localDateInput(date, observer.timezone);
  const now = performance.now();
  if (skySelection && now - lastSkyFacts > 1000) {
    facts(skyMetrics(skySelection));
    const [ra, dec] = skySelection.type === 'constellation' ? skySelection.data.center : skySelection.data.slice(1, 3);
    const above = skyMode.coordinates(ra, dec).altitude >= 0;
    $('travel-button').disabled = !above;
    $('travel-button').firstElementChild.textContent = above ? '가운데 놓기' : '중심이 지평선 아래';
    lastSkyFacts = now;
  }
  if (now - lastSkyList > 5000 && ($('destinations').classList.contains('open') || innerWidth > 700)) updateSkyList();
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
  $('object-badge').textContent = !real ? '생성 천체 · 시각적 재구성' : type === 'planet' ? '실제 천체 · 관측 기반 지도' : type === 'blackhole' ? '실제 천체 · 원반 재구성' : type === 'star' ? '실제 천체 · 표면 재구성' : '실제 천체 · 공간 재구성';
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
  if (state.galaxy?.id !== galaxy.id) state.star = starAt(galaxy, 0);
  state.galaxy = galaxy;
  state.selected = { type: 'galaxy', key: galaxy.id };
  setObject({ name: galaxy.name, code: galaxy.code, kind: galaxy.kind, real: galaxy.real, color: '#b9ccea', type: 'galaxy',
    description: galaxy.description, metrics: [['항성계', '클릭하여 생성'], ['자료 구분', galaxy.real ? '실제 은하 기반' : '상상한 은하']],
    action: '은하 안으로', onTravel: () => navigate('galaxy') });
  updateRoute();
  focusObject(clusterGroups.get(galaxy.id));
}

function selectStar(star) {
  state.star = star;
  state.selected = { type: 'star', key: star.id };
  const label = addStarLabel(star);
  ensurePreview();
  setObject({ name: star.name, code: star.code, kind: `${star.type}형 · ${star.label}`, real: star.real, color: star.color, type: 'star',
    metrics: [['표면 온도', `${decimal.format(star.temperature)} K`], ['항성 질량', `${star.mass} 태양질량`], ['행성', `${makeSystem(star).length}개`], ['소속 은하', state.galaxy.name]],
    description: star.real ? '우리의 출발점. 여덟 행성이 도는 태양계에서 탐험을 시작하세요.' : '처음 만나는 별입니다. 이 별 주위에는 어떤 세계가 있을까요?',
    action: '행성계 탐사', onTravel: () => navigate('system') });
  updateRoute();
  focusObject(label.object);
}

function selectBlackHole() {
  const hole = blackHoleIn(state.galaxy);
  state.selected = { type: 'blackhole', key: 'blackhole' };
  setObject({ name: hole.name, code: hole.code, kind: '초대질량 블랙홀', real: hole.real, color: '#f2ad5f', type: 'blackhole',
    metrics: [['질량', `${readable(hole.mass)} 태양질량`], ['지평선 반지름¹', `${decimal.format(hole.radiusAU)} AU`], ['관측 구조', '그림자 · 강착원반'], ['표현', '비회전 광선 추적']],
    description: hole.real ? '우리 은하 중심의 실제 블랙홀. 비회전 모형에서 빛의 경로를 계산합니다. 얇은 강착원반의 가스 무늬·색·밝기는 구조를 볼 수 있게 재구성한 것입니다. ¹비회전 모형 기준.' : '탐험을 위해 생성한 중심 블랙홀입니다. 비회전 모형의 빛 경로와 얇은 강착원반을 사용합니다. 색·밝기는 시각화용 재구성입니다. ¹비회전 모형 기준.',
    action: state.view === 'blackhole' ? '강착원반 가까이 보기' : '블랙홀 관찰',
    onTravel: () => state.view === 'blackhole' ? moveCamera([0, 7, 25]) : navigate('blackhole') });
  updateRoute();
  if (state.view === 'galaxy') focusObject(galaxyBlackHole);
}

function focusObject(object, track = false) {
  if (!object || rebuilding || scaleChanging) return;
  follow = null;
  previousFollow = null;
  animation = null;
  controls.enabled = true;
  focusTarget = { object, track };
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
  controls.minDistance = detailVisual.userData.radius * 1.15;
  focusObject(starSurface);
}

function selectPlanet(planet, travel = false) {
  state.selected = { type: 'planet', key: planet.id };
  setObject({ name: planet.name, code: `${state.star.code} / ${String.fromCharCode(98 + planet.id).toUpperCase()}`, kind: planetKinds[planet.kind], real: planet.real, color: planet.color, type: 'planet',
    metrics: [['항성까지 거리', `${decimal.format(planet.au)} AU`], ['공전 주기', planet.period < 1000 ? `${readable(planet.period)}일` : `${readable(planet.period / 365.25)}년`], ['반지름', `${planet.radius} 지구반지름`], ['궤도 이심률', planet.eccentricity.toFixed(3)]],
    description: planet.real ? `관측 자료를 바탕으로 가공한 ${solarMapFor(planet).layer}입니다. 색 보정·빈 영역 보완이 포함되며 현재 모습 그대로의 사진은 아닙니다. 시작 위치와 위성 배치는 탐험용 표현입니다.` : '같은 주소에서 다시 만날 수 있는 행성. 표면과 위성은 이 세계를 위한 상상입니다.',
    action: planet.real && planet.id === 2 ? '지구에서 하늘 보기' : '가까이 관찰하기', onTravel: () => planet.real && planet.id === 2 ? openEarthSky() : approachPlanet(planet) });
  updateRoute();
  controls.minDistance = visualRadius(planet) * 1.12;
  focusObject(planetMeshes[planet.id]?.group, true);
  if (travel) approachPlanet(planet);
}

function approachPlanet(planet) {
  const entry = planetMeshes[planet.id];
  if (!entry) return;
  follow = null;
  const target = entry.group.getWorldPosition(new THREE.Vector3());
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
      if (state.view === 'sky') selectSkyConstellation(item.data);
      else if (state.view === 'cluster') selectGalaxy(item.data);
      else if (item.type === 'blackhole') selectBlackHole();
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
  if (view === 'sky') { updateSkyHeadings(); return; }
  $('scene-title').replaceChildren(document.createTextNode(view === 'cluster' ? (state.sector === 0 ? '은하 너머로' : `미지의 구역 ${state.sector}`) : view === 'galaxy' ? state.galaxy.name : view === 'blackhole' ? blackHoleIn(state.galaxy).name : state.star.real ? '태양계' : state.star.name));
  const period = document.createElement('span'); period.textContent = '.'; $('scene-title').append(period);
  $('breadcrumb').textContent = view === 'cluster' ? (state.sector === 0 ? '국부은하군과 상상의 이웃' : `생성 우주 / 구역 ${state.sector}`) : view === 'galaxy' ? `은하 구역 ${state.sector} / ${state.galaxy.code}` : `${state.galaxy.name} / ${view === 'blackhole' ? '은하 중심' : state.star.code}`;
  $('scene-subtitle').textContent = view === 'cluster' ? '하나의 은하를 넘어, 또 다른 세계로.' : view === 'galaxy' ? '익숙한 별에서, 아직 이름 없는 세계로.' : view === 'blackhole' ? '블랙홀의 그림자와 뜨거운 가스 원반을 관찰하세요.' : '작은 세계의 움직임에서, 우주의 시간을 발견하세요.';
  $('scene-count').textContent = view === 'cluster' ? `${galaxyCatalog.length}개의 은하 · 연속 확대` : view === 'galaxy' ? `${STAR_COUNT.toLocaleString('ko-KR')}개의 별 · 블랙홀 탐사` : view === 'blackhole' ? '강착원반 · 광자 고리' : `${state.planets.length}개의 행성`;
  $('scene-model').textContent = view === 'blackhole' ? '비회전 광선 추적 · 원반 재구성' : view === 'system' ? '케플러 공전 · 거리 압축' : '회전 모형 · 공간 재구성';
  $('list-title').textContent = view === 'cluster' ? '은하 목록' : view === 'galaxy' ? '별과 블랙홀' : view === 'blackhole' ? '블랙홀' : '행성 목록';
  $('up-button').textContent = view === 'system' || view === 'blackhole' ? '↖ 은하 탐사로' : view === 'galaxy' ? '↖ 은하 지도로' : '↖ 첫 번째 은하 구역';
  $('up-button').disabled = view === 'cluster' && state.sector === 0;
  $('discover-label').textContent = view === 'cluster' ? '다음 은하 구역으로' : '미지의 별로 떠나기';
  $('sector-code').textContent = `구역 ${String(state.sector).padStart(3, '0')}`;
  $('scale-level').textContent = view === 'cluster' ? '은하와 은하 사이' : view === 'galaxy' ? '은하 규모' : view === 'blackhole' ? '블랙홀 근접 관측' : '행성계 규모';
  $('orbit-button').disabled = view === 'cluster' || view === 'blackhole';
  $('orbit-button').setAttribute('aria-label', '궤도 표시');
  $('orbit-button').setAttribute('aria-pressed', String(state.orbits));
  $('orbit-button').title = '궤도 표시';
  $('reset-time').title = '시간을 기준 시점으로 되돌리기';
  $('reset-time').setAttribute('aria-label', '시간 초기화');
  $('touch-hint').textContent = '한 손가락 회전 · 두 손가락 확대';
  document.querySelectorAll('[data-view]').forEach((button) => { const active = button.dataset.view === view || view === 'blackhole' && button.dataset.view === 'system'; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); });
  document.querySelector('[data-view="system"]').innerHTML = '<span>03</span> 근접 관측';
}

function navigate(view, fromHistory = false) {
  rebuilding = true;
  if (state.view === 'sky' && view !== 'sky') state.paused = spacePaused;
  if (state.view !== view) viewEpoch = state.years;
  state.view = view;
  $('search').value = '';
  state.speed = 3;
  $('speed-slider').value = state.speed;
  if (view === 'sky') buildSky();
  else if (view === 'cluster') buildCluster();
  else if (view === 'galaxy') buildGalaxy();
  else if (view === 'blackhole') buildBlackHole();
  else buildSystem();
  if (orbitGroup) orbitGroup.visible = state.orbits;
  updateHeadings();
  updateTimeUI();
  closeDrawer();
  rebuilding = false;
  updateRoute(fromHistory);
  previousDistance = camera.position.distanceTo(controls.target);
  zoomUntil = 0;
}

function changeScale(next) {
  scene.updateMatrixWorld(true);
  const previousView = state.view;
  let from, to, galaxy, detail, backdrop = null;
  if (previousView === 'cluster') {
    galaxy = clusterGroups.get(state.galaxy.id);
    from = galaxy.matrixWorld.clone();
    galaxy.removeFromParent();
  } else if (previousView === 'galaxy' && next === 'cluster') {
    galaxy = galaxyGroup;
    from = galaxy.matrixWorld.clone();
    galaxy.removeFromParent();
  } else if (previousView === 'galaxy') {
    const hole = state.selected?.type === 'blackhole';
    detail = hole ? { root: galaxyBlackHole, kind: 'blackhole' } : preview;
    from = detail.root.matrixWorld.clone();
    detail.orientation = detail.root.getWorldQuaternion(new THREE.Quaternion());
    const destination = new THREE.Matrix4().compose(new THREE.Vector3(), detail.orientation, new THREE.Vector3(1, 1, 1));
    backdrop = galaxyGroup;
    const backdropMatrix = destination.clone().multiply(from.clone().invert()).multiply(backdrop.matrixWorld);
    detail.root.removeFromParent();
    backdrop.removeFromParent();
    if (hole) backdrop.userData.blackHole = null;
    else backdrop.userData.preview = null;
    backdropMatrix.decompose(backdrop.position, backdrop.quaternion, backdrop.scale);
    backdrop.userData.stars.material.size = 1.3 / DETAIL_SCALE;
    backdrop.userData.dust.material.size = 21 / DETAIL_SCALE;
    next = hole ? 'blackhole' : 'system';
  } else {
    from = systemRoot.matrixWorld.clone();
    detail = previousView === 'blackhole' ? { root: systemRoot, kind: 'blackhole' } : preview;
    detail.root.removeFromParent();
    galaxy = galaxyBackdrop;
    galaxy?.removeFromParent();
  }
  scaleChanging = true;
  rebuilding = true;
  state.view = next;
  viewEpoch = state.years;
  state.speed = 3;
  $('speed-slider').value = 3;
  $('search').value = '';
  if (next === 'cluster') { buildCluster(galaxy); to = clusterGroups.get(state.galaxy.id); }
  else if (next === 'galaxy') {
    buildGalaxy(galaxy, detail);
    to = previousView === 'cluster' ? galaxyGroup : previousView === 'blackhole' ? galaxyBlackHole : preview.root;
  } else if (next === 'blackhole') { buildBlackHole(detail, backdrop); to = systemRoot; }
  else { buildSystem(detail, backdrop); to = systemRoot; }
  scene.updateMatrixWorld(true);
  remapCamera(camera, controls.target, from, to.matrixWorld);
  if (previousView === 'cluster' && next === 'galaxy') selectBlackHole();
  controls.enabled = true;
  controls.update();
  previousDistance = camera.position.distanceTo(controls.target);
  zoomCooldown = performance.now() + 180;
  rebuilding = false;
  scaleChanging = false;
  updateHeadings();
  updateTimeUI();
  updateRoute();
}

function updateContinuousZoom(now) {
  if (state.view === 'sky') return;
  const distance = camera.position.distanceTo(controls.target);
  if (!animation && now > zoomCooldown) {
    if (distance < previousDistance * 0.999) { zoomDirection = 1; zoomUntil = now + 700; }
    else if (distance > previousDistance * 1.001) { zoomDirection = -1; zoomUntil = now + 700; }
    if (now < zoomUntil) {
      let next;
      if (state.view === 'cluster') {
        const target = clusterGroups.get(state.galaxy.id);
        next = zoomBoundary('cluster', camera.position.distanceTo(target.position), zoomDirection, state.galaxy.size);
      } else if (state.view === 'galaxy') {
        if (zoomDirection < 0) next = zoomBoundary('galaxy', camera.position.length(), -1);
        else {
          const object = state.selected?.type === 'blackhole' ? galaxyBlackHole : preview?.root;
          if (object) next = zoomBoundary('galaxy', camera.position.distanceTo(object.getWorldPosition(new THREE.Vector3())), 1);
        }
      } else next = zoomBoundary(state.view, camera.position.length(), zoomDirection);
      if (next) { changeScale(next); return; }
    }
  }
  previousDistance = distance;
}

function updateRoute(replace = true) {
  if (rebuilding || !state.galaxy || !state.star) return;
  const params = new URLSearchParams({ view: state.view, sector: state.sector, galaxy: state.galaxy.id, star: state.star.id });
  if (state.view === 'sky' && skyMode) {
    params.set('place', skyMode.state.observer.id);
    params.set('time', new Date(skyMode.state.time).toISOString());
    if (skyMode.state.observer.id === 'custom') { params.set('lat', skyMode.state.observer.latitude); params.set('lon', skyMode.state.observer.longitude); }
  }
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
  const view = ['cluster', 'galaxy', 'system', 'blackhole', 'sky'].includes(params.get('view')) ? params.get('view') : 'cluster';
  if (view === 'sky') {
    const observer = { ...(OBSERVERS.find((entry) => entry.id === params.get('place')) || OBSERVERS[0]) };
    if (observer.id === 'custom') {
      const latitude = Number(params.get('lat')), longitude = Number(params.get('lon'));
      if (params.has('lat') && params.has('lon') && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) Object.assign(observer, { latitude, longitude });
    }
    const date = new Date(params.get('time') || '');
    skyConfig = { observer, date: Number.isFinite(date.getTime()) ? date : tonight(observer) };
    if (!skyCatalog) { navigate('cluster', true); openEarthSky(true); return; }
  }
  const selectedPlanet = params.has('planet') ? Number(params.get('planet')) : -1;
  navigate(view, true);
  if (view === 'system' && Number.isInteger(selectedPlanet) && state.planets[selectedPlanet]) selectPlanet(state.planets[selectedPlanet]);
}

function updateTimeUI() {
  if (state.view === 'sky') { updateSkyTimeUI(); return; }
  const speed = speeds[state.view][state.speed];
  const close = state.view === 'system' || state.view === 'blackhole';
  let unit = close ? '일' : '년';
  let amount = close ? speed * 365.25 : speed;
  if (close && amount < .01) { amount *= 86400; unit = '초'; }
  $('speed-label').textContent = `${state.direction < 0 ? '−' : ''}${readable(amount, 2)}${unit} / 초`;
  const elapsedYears = state.years - viewEpoch;
  const abs = Math.abs(elapsedYears);
  const days = abs * 365.25;
  const duration = days < 1 / 1440 ? `${readable(days * 86400, 1)}초` : days < 1 / 24 ? `${readable(days * 1440, 1)}분` : days < 1 ? `${readable(days * 24, 1)}시간` : abs < 1 ? `${readable(days, 1)}일` : `${readable(abs, 2)}년`;
  $('elapsed').textContent = abs < 1e-12 ? '기준 시점' : `${elapsedYears < 0 ? '−' : '+'}${duration}`;
  $('pause-button').textContent = state.paused ? '▶' : 'Ⅱ';
  $('pause-button').setAttribute('aria-label', state.paused ? '시간 재생' : '시간 정지');
  $('reverse-button').setAttribute('aria-pressed', String(state.direction < 0));
  $('reverse-button').setAttribute('aria-label', state.direction < 0 ? '시간 정방향 재생' : '시간 역재생');
  $('live-status').lastChild.textContent = state.paused ? '시간 정지됨' : state.direction < 0 ? '시간 역재생 중' : '시간 진행 중';
  const destination = state.view === 'cluster' ? state.galaxy.name : state.view === 'galaxy' ? state.selected?.type === 'blackhole' ? blackHoleIn(state.galaxy).name : `${state.star.name}의 행성계` : state.selected?.type === 'planet' ? state.planets[state.selected.key].name : state.view === 'blackhole' ? '강착원반' : state.star.name;
  $('zoom-destination').textContent = `확대 → ${destination}`;
  $('zoom-return').textContent = state.view === 'cluster' ? '천체 클릭으로 초점 이동' : `축소 → ${state.view === 'galaxy' ? '은하 지도' : '은하 전체'}`;
  const distance = camera.position.distanceTo(controls.target);
  const galaxyDistance = state.view === 'cluster' ? distance * 150 / state.galaxy.size : close ? distance * DETAIL_SCALE : distance;
  $('scale-level').textContent = `${close ? '근접 관측' : state.view === 'cluster' ? '은하 지도' : '은하 내부'} · ${readable(2500 / Math.max(.001, galaxyDistance), 1)}배`;
}

function updateGalaxyAppearance() {
  const groups = state.view === 'cluster' ? [...clusterGroups.values()] : [galaxyGroup || galaxyBackdrop].filter(Boolean);
  for (const group of groups) {
    const distance = camera.position.distanceTo(group.getWorldPosition(new THREE.Vector3())) / group.scale.x;
    const density = THREE.MathUtils.clamp((400 / Math.max(1, distance)) ** 1.5, .2, 1);
    group.userData.stars.material.opacity = .9 * density;
    group.userData.dust.material.opacity = .12 * density * THREE.MathUtils.smoothstep(distance, 40, 180);
    const coreVisibility = THREE.MathUtils.smoothstep(distance, 25, 110);
    for (const child of group.children) if (child.isSprite) child.material.opacity = (child === group.userData.core ? .9 : .8) * coreVisibility;
  }
}

function updateCelestialPositions() {
  if (galaxyGroup) galaxyGroup.rotation.y = galaxyGroup.userData.baseRotationY + state.years / 220e6 * TAU;
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
  if (detailVisual) updateObjectVisual(detailVisual, state.years * 365.25, camera);
  if (galaxyBlackHole) updateObjectVisual(galaxyBlackHole, state.years * 365.25, camera);
}

function projectLabels() {
  const rects = [];
  const width = $('app').clientWidth, height = $('app').clientHeight;
  for (const label of [...labels].sort((a, b) => (b.button.classList.contains('selected') ? 10 : b.priority) - (a.button.classList.contains('selected') ? 10 : a.priority))) {
    label.object.getWorldPosition(vector);
    if (state.view === 'sky' && (vector.y < 0 || !skyMode.state.names && label.key?.startsWith('sky:'))) { label.button.style.display = 'none'; continue; }
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
  if (state.view === 'sky' && skyMode) {
    skyMode.step(dt, state.paused || document.hidden, state.direction, state.speed);
    renderer.render(scene, camera);
    projectLabels();
    if (now - lastUI > 150) { updateSkyTimeUI(); lastUI = now; }
    return;
  }
  if (!state.paused && !document.hidden) state.years += dt * speeds[state.view][state.speed] * state.direction;
  updateCelestialPositions();
  if (animation) {
    if (animation.followAfter) {
      const delta = animation.followAfter.getWorldPosition(new THREE.Vector3()).sub(animation.toTarget);
      animation.to.add(delta);
      animation.toTarget.add(delta);
    }
    const t = animation.duration ? Math.min(1, (now - animation.start) / animation.duration) : 1;
    const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    camera.position.lerpVectors(animation.from, animation.to, ease);
    controls.target.lerpVectors(animation.fromTarget, animation.toTarget, ease);
    if (t === 1) {
      follow = animation.followAfter || null;
      previousFollow = follow?.getWorldPosition(new THREE.Vector3()) || null;
      animation = null;
      controls.enabled = true;
    }
  } else if (follow) {
    const current = follow.getWorldPosition(new THREE.Vector3());
    const delta = current.clone().sub(previousFollow);
    camera.position.add(delta);
    controls.target.add(delta);
    previousFollow.copy(current);
  }
  if (focusTarget && !animation) {
    const center = focusTarget.object.getWorldPosition(new THREE.Vector3());
    const delta = center.sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 9));
    camera.position.add(delta);
    controls.target.add(delta);
    if (delta.length() < 0.001) {
      if (focusTarget.track) { follow = focusTarget.object; previousFollow = follow.getWorldPosition(new THREE.Vector3()); }
      focusTarget = null;
    }
  }
  controls.update();
  updateContinuousZoom(now);
  updateGalaxyAppearance();
  background.position.copy(camera.position);
  if (state.view === 'system' || state.view === 'blackhole') opticalRenderer.render(scene, camera);
  else renderer.render(scene, camera);
  projectLabels();
  if (now - lastUI > 150) { updateTimeUI(); lastUI = now; }
}

function closeDrawer() { $('destinations').classList.remove('open'); $('drawer-button').setAttribute('aria-expanded', 'false'); $('drawer-backdrop').hidden = true; }
function goUp() {
  if (state.view === 'sky') { if (lastSpaceHash) location.hash = lastSpaceHash; else navigate('cluster'); }
  else if (state.view === 'system' || state.view === 'blackhole') navigate('galaxy');
  else if (state.view === 'galaxy') navigate('cluster');
  else { state.sector = 0; state.galaxy = galaxiesInSector(0)[0]; state.star = starAt(state.galaxy, 0); navigate('cluster'); }
}

function bindEvents() {
  const input = $('scene-input');
  let labelPointer = null;
  document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => navigate(button.dataset.view === 'system' && state.selected?.type === 'blackhole' ? 'blackhole' : button.dataset.view));
  $('search').oninput = renderList;
  $('up-button').onclick = goUp;
  $('sky-button').onclick = () => openEarthSky();
  function refreshSky() {
    updateSkyControls(); updateSkyHeadings(); updateSkyList(); updateSkyTimeUI(); updateRoute();
    if (skySelection?.type === 'constellation') selectSkyConstellation(skySelection.data);
    else if (skySelection) selectSkyStar(skySelection.data);
  }
  $('sky-place').onchange = () => {
    skyMode.setObserver(OBSERVERS.find((observer) => observer.id === $('sky-place').value));
    refreshSky();
  };
  for (const id of ['sky-latitude', 'sky-longitude']) $(id).onchange = () => {
    if (!$('sky-latitude').value || !$('sky-longitude').value || !$('sky-latitude').reportValidity() || !$('sky-longitude').reportValidity()) return;
    skyMode.setObserver({ ...OBSERVERS.at(-1), latitude: Number($('sky-latitude').value), longitude: Number($('sky-longitude').value) });
    refreshSky();
  };
  $('sky-datetime').onchange = () => {
    if (!$('sky-datetime').reportValidity()) return;
    const date = dateFromLocal($('sky-datetime').value, skyMode.state.observer.timezone);
    if (!date) { toast('유효한 현지 시각을 입력해 주세요. 서머타임 전환 때는 없는 시각도 있습니다.'); return; }
    skyMode.setDate(date); state.paused = true; refreshSky();
  };
  $('sky-tonight').onclick = () => { skyMode.setDate(tonight(skyMode.state.observer)); state.paused = true; refreshSky(); };
  $('sky-now').onclick = () => { skyMode.setDate(new Date()); state.speed = 0; state.direction = 1; state.paused = false; $('speed-slider').value = 0; refreshSky(); };
  $('sky-lines').onchange = () => { skyMode.state.lines = $('sky-lines').checked; updateSkyHeadings(); };
  $('sky-names').onchange = () => { skyMode.state.names = $('sky-names').checked; };
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
  $('reset-time').onclick = () => {
    if (skyMode) { skyMode.setObserver(OBSERVERS[0]); skyMode.setDate(tonight(OBSERVERS[0])); state.paused = true; refreshSky(); toast('서울의 오늘 밤 9시로 돌아왔습니다'); return; }
    state.years = 0; viewEpoch = 0; updateCelestialPositions(); updateTimeUI(); toast('기준 시점으로 돌아왔습니다');
  };
  $('orbit-button').onclick = () => {
    if (skyMode) { skyMode.state.lines = !skyMode.state.lines; $('sky-lines').checked = skyMode.state.lines; updateSkyHeadings(); return; }
    state.orbits = !state.orbits;
    if (orbitGroup) orbitGroup.visible = state.orbits;
    $('orbit-button').setAttribute('aria-pressed', String(state.orbits));
  };
  $('drawer-button').onclick = () => { const open = $('destinations').classList.toggle('open'); $('drawer-button').setAttribute('aria-expanded', String(open)); $('drawer-backdrop').hidden = !open; };
  $('drawer-backdrop').onclick = closeDrawer;
  $('object-toggle').onclick = () => { const expanded = $('object-card').classList.toggle('expanded'); $('object-toggle').setAttribute('aria-expanded', String(expanded)); $('object-toggle').textContent = expanded ? '정보 접기 ⌄' : '정보 보기 ⌃'; };
  $('help-button').onclick = () => $('help-dialog').showModal();
  $('close-help').onclick = () => $('help-dialog').close();
  $('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) { const r = $('help-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('help-dialog').close(); } });
  if (!document.documentElement.requestFullscreen) $('fullscreen-button').hidden = true;
  $('fullscreen-button').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { toast('이 브라우저에서는 전체 화면을 사용할 수 없습니다'); }
  };
  document.querySelector('.brand').onclick = (event) => { event.preventDefault(); state.sector = 0; state.galaxy = galaxiesInSector()[0]; state.star = starAt(state.galaxy, 0); navigate('cluster'); };
  for (const direction of [1, -1]) {
    $(direction === 1 ? 'zoom-in' : 'zoom-out').onclick = () => {
      if (skyMode) { skyMode.zoom(direction === 1 ? .8 : 1.25); return; }
      animation = null;
      controls.enabled = true;
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.clamp(offset.length() * (direction === 1 ? 0.65 : 1.54), controls.minDistance, controls.maxDistance));
      camera.position.copy(controls.target).add(offset);
      zoomDirection = direction;
      zoomUntil = performance.now() + 900;
    };
  }
  addEventListener('keydown', (event) => {
    if ($('help-dialog').open) return;
    if (event.code === 'Escape' && $('destinations').classList.contains('open')) { closeDrawer(); return; }
    if (event.target.matches('input,button,select,textarea')) return;
    if (event.code === 'Space') { event.preventDefault(); state.paused = !state.paused; updateTimeUI(); }
    if (event.code === 'Escape') { closeDrawer(); goUp(); }
  });
  addEventListener('hashchange', parseRoute);
  input.addEventListener('wheel', (event) => {
    const now = performance.now();
    zoomDirection = event.deltaY < 0 ? 1 : -1;
    zoomUntil = now + 700;
  }, { passive: true, capture: true });
  const tapTracker = createTapTracker();
  input.addEventListener('pointerdown', (event) => { labelPointer = event.target.closest('.sky-label'); tapTracker.start(event); closeDrawer(); });
  input.addEventListener('pointermove', tapTracker.move);
  input.addEventListener('pointercancel', (event) => { tapTracker.cancel(event); labelPointer = null; });
  input.addEventListener('pointerup', (event) => {
    const tap = tapTracker.finish(event);
    const label = labelPointer;
    labelPointer = null;
    if (skyMode || !tap || animation || event.button !== 0) return;
    if (label) { label.click(); return; }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points.threshold = Math.max(0.35, camera.position.distanceTo(controls.target) * 0.0025);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return;
    const hit = hits[0];
    if (hit.object.userData.galaxyStars && hit.index !== undefined) selectStar(starAt(state.galaxy, hit.index));
    else hit.object.userData.select?.();
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); showError('그래픽 연결이 중단되었습니다. 화면을 다시 열어 주세요.'); });
  const resize = () => { const width = $('app').clientWidth, height = $('app').clientHeight; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); };
  addEventListener('resize', resize);
  new ResizeObserver(resize).observe($('app'));
}

function showError(message) { $('error-message').textContent = message; $('error-panel').hidden = false; $('loading').classList.add('done'); }

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 1.75));
  renderer.setSize($('app').clientWidth, $('app').clientHeight);
  renderer.setClearColor('#04070d');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  opticalRenderer = createOpticalRenderer(renderer);
  $('viewport').append(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(49, $('app').clientWidth / $('app').clientHeight, 0.05, 9000);
  controls = new OrbitControls(camera, $('scene-input'));
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.8;
  glow = glowTexture();
  createBackground();
  if (new URLSearchParams(location.hash.slice(1)).get('view') === 'sky') skyCatalog = await loadSkyCatalog();
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
