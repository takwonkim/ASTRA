export const STAR_COUNT = 20000;
export const TAU = Math.PI * 2;

export function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function random(seed) {
  let state = typeof seed === 'number' ? seed : hash(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const knownGalaxies = [
  { id: 'milky-way', name: '우리 은하', code: 'Milky Way', kind: '막대나선은하', arms: 4, hue: 0.61, position: [0, 0, 0], size: 48, real: true, description: '태양계가 속한 은하. 익숙한 태양에서 출발해, 이름 없는 별까지 항로를 넓혀 보세요.' },
  { id: 'andromeda', name: '안드로메다', code: 'M31', kind: '나선은하', arms: 2, hue: 0.58, position: [225, 25, -125], size: 66, real: true, description: '우리 은하의 이웃인 거대한 나선은하. 여기서 만나는 개별 항성계는 탐험을 위해 생성됩니다.' },
  { id: 'triangulum', name: '삼각형자리 은하', code: 'M33', kind: '나선은하', arms: 3, hue: 0.63, position: [270, -40, 100], size: 34, real: true, description: '국부은하군의 또 다른 나선은하. 푸른 나선팔 사이에 새로운 세계들이 기다립니다.' },
  { id: 'large-magellanic', name: '대마젤란운', code: 'LMC', kind: '불규칙은하', arms: 1, hue: 0.64, position: [-110, -65, 85], size: 22, real: true, irregular: true, description: '우리 은하의 위성은하. 불규칙한 별무리 사이를 탐사할 수 있습니다.' },
  { id: 'small-magellanic', name: '소마젤란운', code: 'SMC', kind: '불규칙은하', arms: 1, hue: 0.66, position: [-160, -70, 55], size: 15, real: true, irregular: true, description: '작고 불규칙한 이웃 은하. 이름과 형태는 실제 천체를 바탕으로 재구성했습니다.' }
];

const prefixes = ['아우로라', '에코', '오르비스', '네레이드', '칼립소', '헬리오스', '루멘', '아르카', '벨라', '셀레네', '이오스', '녹스'];

export function galaxiesInSector(sector = 0) {
  const rng = random(`astra-sector-${sector}`);
  const generated = Array.from({ length: sector === 0 ? 5 : 12 }, (_, index) => {
    const angle = index * 2.39996 + rng();
    const radius = 210 + rng() * 300;
    return {
      id: `sector-${sector}-${index}`, name: `${prefixes[(index + Math.abs(sector) * 3) % prefixes.length]} ${Math.abs(sector) + 1}-${index + 1}`,
      code: `AST ${sector}:${index + 1}`, kind: '생성 나선은하', arms: 2 + Math.floor(rng() * 4), hue: 0.54 + rng() * 0.18,
      position: [Math.cos(angle) * radius, (rng() - 0.5) * 170, Math.sin(angle) * radius],
      size: 22 + rng() * 34, real: false,
      description: '관측되지 않은 우주를 상상해 만든 은하. 같은 구역과 주소로 돌아오면 같은 별과 행성을 만납니다.'
    };
  });
  return sector === 0 ? [...knownGalaxies, ...generated] : generated;
}

const spectral = [
  { type: 'M', label: '적색왜성', color: '#ffb07c', temperature: 3200, mass: 0.35 },
  { type: 'K', label: '주황색 주계열성', color: '#ffd09c', temperature: 4700, mass: 0.75 },
  { type: 'G', label: '황색 주계열성', color: '#ffe5b5', temperature: 5800, mass: 1 },
  { type: 'F', label: '황백색 주계열성', color: '#eef3ff', temperature: 6900, mass: 1.3 },
  { type: 'A', label: '백색 주계열성', color: '#c2d8ff', temperature: 9000, mass: 2 },
  { type: 'B', label: '청백색 주계열성', color: '#90bbff', temperature: 15000, mass: 5 }
];

export function starAt(galaxy, index) {
  if (galaxy.id === 'milky-way' && index === 0) {
    return { id: 0, seed: 'sol', name: '태양', code: 'SOL', real: true, position: [64, 1, 48], ...spectral[2], temperature: 5772, mass: 1 };
  }
  const rng = random(`${galaxy.id}/star/${index}`);
  const radius = 7 + Math.pow(rng(), 0.65) * 144;
  let angle = index % galaxy.arms * TAU / galaxy.arms + Math.log(radius / 8) * 1.5 + (rng() - 0.5) * (galaxy.irregular ? 3.5 : 0.65);
  const bulge = rng() < 0.14;
  const r = bulge ? Math.pow(rng(), 0.7) * 29 : radius;
  if (bulge) angle = rng() * TAU;
  const starType = spectral[Math.floor(Math.pow(rng(), 1.7) * spectral.length)];
  const temperature = Math.round(starType.temperature * (0.9 + rng() * 0.2));
  return {
    id: index, seed: `${galaxy.id}/${index}`, name: `${prefixes[hash(galaxy.id) % prefixes.length]} ${String(index).padStart(5, '0')}`,
    code: `AST-${String(index).padStart(5, '0')}`, real: false,
    position: [Math.cos(angle) * r, (rng() - 0.5) * (bulge ? 24 : 5 + (1 - r / 160) * 5), Math.sin(angle) * r],
    ...starType, temperature, mass: +(starType.mass * (0.85 + rng() * 0.3)).toFixed(2)
  };
}

const solarPlanets = [
  ['수성', 0.387, 0.383, 87.969, 'rock', '#b3a89c', 0.2056, 58.646],
  ['금성', 0.723, 0.949, 224.701, 'desert', '#d7b67e', 0.0068, -243.025],
  ['지구', 1, 1, 365.256, 'ocean', '#508fc3', 0.0167, 0.9973],
  ['화성', 1.524, 0.532, 686.98, 'desert', '#bd6e47', 0.0934, 1.026],
  ['목성', 5.203, 11.21, 4332.59, 'gas', '#d8b49b', 0.0489, 0.4135],
  ['토성', 9.537, 9.45, 10759.22, 'gas', '#d9c58d', 0.0565, 0.444],
  ['천왕성', 19.191, 4.01, 30688.5, 'ice', '#8ad4d8', 0.0472, -0.7183],
  ['해왕성', 30.069, 3.88, 60182, 'ice', '#4476d4', 0.0086, 0.6713]
];

export function makeSystem(star) {
  const rng = random(`${star.seed}/planets`);
  if (star.real && star.seed === 'sol') {
    return solarPlanets.map(([name, au, radius, period, kind, color, eccentricity, day], index) => ({
      id: index, name, au, radius, period, kind, color, eccentricity, day, phase: index * 0.79 + 0.4,
      inclination: index === 0 ? 0.12 : index * 0.006, rings: index === 5, real: true,
      seed: `sol/${index}`, moons: index === 2 ? 1 : index >= 4 ? 3 : 0
    }));
  }
  const count = 3 + Math.floor(rng() * 6);
  let au = 0.1 + rng() * 0.18;
  return Array.from({ length: count }, (_, index) => {
    au *= 1.5 + rng() * 0.7;
    const kind = au < Math.sqrt(star.mass) * 0.6 ? (rng() > 0.4 ? 'lava' : 'desert') : au < 2.2 * Math.sqrt(star.mass) ? (rng() > 0.35 ? 'ocean' : 'rock') : rng() > 0.45 ? 'gas' : 'ice';
    const palettes = { lava: ['#c95038', '#f88d46'], desert: ['#caa476', '#c9875d'], ocean: ['#398fac', '#4e6ec0'], rock: ['#9f9b94', '#8c7f9d'], gas: ['#c79d7a', '#a58dba', '#d9bd8a'], ice: ['#85cad7', '#7894cd'] };
    const palette = palettes[kind];
    return {
      id: index, name: `${star.name} ${String.fromCharCode(98 + index)}`, au: +au.toFixed(3),
      radius: +(kind === 'gas' ? 4 + rng() * 8 : 0.4 + rng() * 2).toFixed(2),
      period: Math.sqrt(au ** 3 / star.mass) * 365.25, kind, color: palette[Math.floor(rng() * palette.length)],
      eccentricity: 0.01 + rng() * 0.2, day: 0.3 + rng() * 4, phase: rng() * TAU,
      inclination: (rng() - 0.5) * 0.14, rings: kind === 'gas' && rng() > 0.4,
      real: false, seed: `${star.seed}/${index}`, moons: kind === 'gas' ? 3 : rng() > 0.5 ? 1 : 0
    };
  });
}

// 케플러 방정식으로 타원 궤도상의 위치를 구한다. 화면에서는 궤도 간격을 압축한다.
export function orbitPosition(planet, years, radius = planet.au) {
  const mean = ((years * 365.25 % planet.period) / planet.period * TAU + planet.phase) % TAU;
  let eccentric = mean;
  for (let i = 0; i < 7; i++) eccentric -= (eccentric - planet.eccentricity * Math.sin(eccentric) - mean) / (1 - planet.eccentricity * Math.cos(eccentric));
  const x = radius * (Math.cos(eccentric) - planet.eccentricity);
  const z = radius * Math.sqrt(1 - planet.eccentricity ** 2) * Math.sin(eccentric);
  return [x, Math.sin(planet.inclination) * z, Math.cos(planet.inclination) * z];
}

export function visualOrbit(index) { return 10 + index * 7 + index ** 1.25 * 1.2; }
export function visualRadius(planet) { return 0.65 + Math.pow(planet.radius, 0.55) * 0.65; }
export const planetKinds = { rock: '암석 행성', desert: '건조한 암석 행성', ocean: '해양형 행성', lava: '용암형 행성', gas: '가스 거성', ice: '얼음형 행성' };
