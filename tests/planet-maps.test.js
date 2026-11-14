import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SOLAR_MAPS, solarMapFor } from '../src/planet-maps.js';
import { galaxiesInSector, starAt, makeSystem } from '../src/universe.js';

test('태양계 8개 지도는 출처 파일과 일치하고 생성 행성에는 적용하지 않는다', async () => {
  const root = new URL('../data/planets/', import.meta.url);
  const sources = JSON.parse(await readFile(new URL('sources.json', root)));
  const galaxy = galaxiesInSector()[0];
  const planets = makeSystem(starAt(galaxy, 0));
  assert.equal(SOLAR_MAPS.length, 8);
  assert.equal(sources.maps.length, 8);
  for (const planet of planets) {
    const map = solarMapFor(planet);
    const source = sources.maps.find((entry) => entry.file === map.file);
    const bytes = await readFile(new URL(map.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
  }
  for (const planet of makeSystem(starAt(galaxy, 123))) assert.equal(solarMapFor(planet), null);
});

test('구름·지형·반사·고리·태양·야간 지도 파일은 기록된 해시와 일치한다', async () => {
  const root = new URL('../data/planets/', import.meta.url);
  const sources = JSON.parse(await readFile(new URL('sources.json', root)));
  assert.equal(sources.detail_maps.length, 6);
  for (const source of sources.detail_maps) {
    const bytes = await readFile(new URL(source.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.equal(bytes.length, source.bytes);
  }
});
