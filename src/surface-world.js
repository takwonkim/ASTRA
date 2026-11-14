import { hash } from './universe.js?v=3';

export function surfaceProfile(planet, star) {
  const stellar = !planet;
  const giant = !!planet && (planet.kind === 'gas' || planet.real && planet.seed === `sol/${planet.id}` && planet.id >= 6);
  const kind = stellar ? 'star' : giant ? 'gas' : planet.kind;
  const actual = planet?.real && planet.seed === `sol/${planet.id}`;
  const airless = actual && planet.id === 0 || !actual && kind === 'rock';
  const venus = actual && planet.id === 1;
  const colors = {
    star: [star.real && star.seed === 'sol' ? '#ffad50' : star.color, '#5c1a0c', '#57200c'], gas: [planet?.color, '#66567b', planet?.color],
    rock: ['#a99b88', '#36333a', '#080a12'], desert: [venus ? '#aa8452' : '#ad6748', '#53372e', venus ? '#bca071' : '#ad8672'],
    ocean: ['#6f8058', '#3d4841', '#709fbd'], ice: ['#a7c5ce', '#4b687e', '#1d334d'], lava: ['#4b3530', '#1d181c', '#4c2520']
  }[kind];
  const profile = { kind, seed: hash(`${planet?.seed || star.seed}/surface`), name: planet?.name || star.name,
    ground: colors[0], dark: colors[1], sky: airless ? '#060810' : colors[2], airless,
    label: stellar ? '항성 표면 비행' : giant ? '구름 위 비행' : '지표 착륙',
    minimum: stellar ? 34 : giant ? 35 : 2.2, arrival: stellar ? 60 : giant ? 90 : 2.2,
    speed: stellar ? 150 : giant ? 100 : 12, haze: stellar ? .00045 : airless ? .00005 : venus ? .0012 : .00024,
    clouds: airless || stellar ? 0 : venus ? .7 : kind === 'ocean' || giant ? .45 : .06,
    note: stellar ? '플라스마 표면 재구성 · 가상 비행' : giant ? '고체 지표 없는 대기 · 가상 비행' : '지표 재구성 · 가상 착륙지' };
  profile.referenceHeight = rawTerrain(profile, 0, 0);
  return profile;
}

function randomCell(x, z, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

function noise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let u = x - ix, v = z - iz;
  u *= u * (3 - 2 * u); v *= v * (3 - 2 * v);
  const a = randomCell(ix, iz, seed), b = randomCell(ix + 1, iz, seed);
  const c = randomCell(ix, iz + 1, seed), d = randomCell(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a + (d - c - b + a) * u) * v;
}

function rawTerrain(profile, x, z) {
  let sum = 0, amplitude = 1, frequency = 1 / 1100;
  for (let i = 0; i < 6; i++) {
    sum += (noise(x * frequency, z * frequency, profile.seed + i * 137) * 2 - 1) * amplitude;
    frequency *= 2.13; amplitude *= .46;
  }
  if (profile.kind === 'star') return sum * 4;
  if (profile.kind === 'gas') return sum * 95 + Math.sin(z / 360) * 40;
  let height = sum * (profile.kind === 'ice' ? 90 : 160);
  if (profile.kind === 'ocean') height += 65 - x * .035;
  if (profile.kind === 'rock') {
    const cellX = Math.floor(x / 550), cellZ = Math.floor(z / 550);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const cx = cellX + a, cz = cellZ + b;
      const px = (cx + randomCell(cx, cz, profile.seed)) * 550;
      const pz = (cz + randomCell(cx, cz, profile.seed + 19)) * 550;
      const radius = 45 + randomCell(cx, cz, profile.seed + 47) * 140;
      const r = Math.hypot(x - px, z - pz) / radius;
      height += 18 * Math.exp(-(((r - 1) / .13) ** 2)) - 32 * Math.max(0, 1 - r * r);
    }
  }
  return height;
}

export function terrainHeight(profile, x, z) {
  const height = rawTerrain(profile, x, z);
  if (profile.kind === 'star' || profile.kind === 'gas') return height;
  // 주변의 높이에 맞춘 작은 착륙 구역을 둔다.
  const distance = Math.hypot(x, z), blend = Math.min(1, Math.max(0, (distance - 18) / 110));
  return (height - profile.referenceHeight) * blend * blend * (3 - 2 * blend) + (profile.kind === 'ocean' ? 22 : 0);
}

export function surfaceAltitude(profile, altitude) {
  return Math.max(profile.minimum, Math.min(1e8, altitude));
}

export function moveOnSurface(position, profile, forward, sideways, lift, dt) {
  const length = Math.max(1, Math.hypot(forward, sideways));
  const speed = profile.speed * Math.max(1, Math.min(8, position.altitude / 90));
  position.x += (Math.sin(position.yaw) * forward + Math.cos(position.yaw) * sideways) / length * speed * dt;
  position.z += (-Math.cos(position.yaw) * forward + Math.sin(position.yaw) * sideways) / length * speed * dt;
  position.altitude = surfaceAltitude(profile, position.altitude + lift * Math.max(18, position.altitude * .7) * dt);
}
