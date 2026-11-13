import test from 'node:test';
import assert from 'node:assert/strict';
import { galaxiesInSector, starAt, makeSystem, orbitPosition, STAR_COUNT } from '../src/universe.js';

test('같은 구역과 천체 주소는 다시 방문해도 같은 세계를 만든다', () => {
  for (const sector of [0, 1, 247, 999999]) {
    assert.deepEqual(galaxiesInSector(sector), galaxiesInSector(sector));
    for (const galaxy of galaxiesInSector(sector)) {
      for (const index of [0, 97, STAR_COUNT - 1]) {
        const first = starAt(galaxy, index);
        const second = starAt(galaxy, index);
        assert.deepEqual(first, second);
        assert.deepEqual(makeSystem(first), makeSystem(second));
        assert.ok(first.position.every(Number.isFinite));
        for (const planet of makeSystem(first)) {
          assert.ok(planet.period > 0 && planet.au > 0 && planet.radius > 0);
          assert.ok(planet.eccentricity >= 0 && planet.eccentricity < 1);
          assert.ok(orbitPosition(planet, -1e8).every(Number.isFinite));
        }
      }
    }
  }
});

test('태양계에는 실제 이름을 가진 여덟 행성이 순서대로 있다', () => {
  const sun = starAt(galaxiesInSector(0)[0], 0);
  assert.equal(sun.name, '태양');
  assert.equal(sun.real, true);
  const planets = makeSystem(sun);
  assert.deepEqual(planets.map((p) => p.name), ['수성', '금성', '지구', '화성', '목성', '토성', '천왕성', '해왕성']);
  assert.equal(planets[2].au, 1);
  assert.equal(planets[2].radius, 1);
});

test('한 주기 뒤에는 같은 궤도 위치로 돌아오고 역재생도 같은 궤도를 따른다', () => {
  for (const galaxy of galaxiesInSector(0).slice(0, 3)) {
    for (const planet of makeSystem(starAt(galaxy, 0))) {
      const periodYears = planet.period / 365.25;
      const initial = orbitPosition(planet, 0);
      for (const time of [periodYears, -periodYears, periodYears * 20]) {
        const position = orbitPosition(planet, time);
        initial.forEach((v, index) => assert.ok(Math.abs(v - position[index]) < planet.au * 1e-10));
      }
      const periapsis = orbitPosition({ ...planet, phase: 0 }, 0);
      assert.ok(Math.abs(periapsis[0] - planet.au * (1 - planet.eccentricity)) < 1e-9);
    }
  }
});

test('다른 구역과 별에는 서로 다른 행성계가 생성된다', () => {
  const sectors = [1, 2, 3].flatMap(galaxiesInSector);
  assert.equal(new Set(sectors.map((g) => g.id)).size, sectors.length);
  const galaxy = galaxiesInSector(1)[0];
  assert.notDeepEqual(makeSystem(starAt(galaxy, 17)), makeSystem(starAt(galaxy, 18)));
});
