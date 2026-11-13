import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { julianDate, siderealDegrees, precessJ2000, equatorialVector, horizontalVector, altitudeAzimuth, dateFromLocal, localDateInput, OBSERVERS } from '../src/sky-math.js';

test('J2000 기준 항성시는 공개 기준값과 맞는다', () => {
  const date = new Date('2000-01-01T12:00:00Z');
  assert.equal(julianDate(date), 2451545);
  assert.ok(Math.abs(siderealDegrees(date) - 280.460618) < .0001);
});

test('천정·북극·동쪽 방향은 거울상 없이 지평좌표에 놓인다', () => {
  const date = new Date('2026-11-13T12:00:00Z');
  const observer = OBSERVERS[0];
  const ra = siderealDegrees(date, observer.longitude);
  const zenith = horizontalVector(ra, observer.latitude, date, observer, false);
  assert.ok(Math.abs(zenith[1] - 1) < 1e-12);
  const pole = horizontalVector(0, 90, date, observer, false);
  assert.ok(Math.abs(Math.asin(pole[1]) * 180 / Math.PI - observer.latitude) < 1e-10);
  const equator = { latitude: 0, longitude: 0 };
  const east = horizontalVector(siderealDegrees(date) + 90, 0, date, equator, false);
  assert.ok(east[0] > .999999999 && Math.abs(east[1]) < 1e-12);
});

test('세차 좌표는 ERFA pmat76 공개 기준 행렬의 첫 열과 맞는다', () => {
  // ERFA t_pmat76: MJD 50123.9999, J2000에서의 평균 세차 행렬.
  const date = new Date((2400000.5 + 50123.9999 - 2440587.5) * 86400000);
  const [ra, dec] = precessJ2000(0, 0, date);
  const v = equatorialVector(ra, dec);
  assert.ok(Math.abs(v[0] - .9999995504328350733) < 1e-12);
  assert.ok(Math.abs(-v[2] - (-.0008696632209485112)) < 1e-12);
  assert.ok(Math.abs(v[1] - (-.0003779153474950335)) < 1e-12);
});

test('지역별 현지 시각은 한국·뉴욕·런던의 시간대를 적용한다', () => {
  assert.equal(dateFromLocal('2026-11-13T21:00', 'Asia/Seoul').toISOString(), '2026-11-13T12:00:00.000Z');
  assert.equal(dateFromLocal('2026-07-01T21:00', 'America/New_York').toISOString(), '2026-07-02T01:00:00.000Z');
  assert.equal(dateFromLocal('2026-07-01T21:00', 'Europe/London').toISOString(), '2026-07-01T20:00:00.000Z');
  assert.equal(localDateInput(new Date('2026-11-13T12:00:00Z'), 'Asia/Seoul'), '2026-11-13T21:00');
  assert.equal(dateFromLocal('2026-03-08T02:30', 'America/New_York'), null);
});

test('실제 별 자료와 88개 별자리 자료를 유효한 관측 좌표로 읽는다', async () => {
  const data = JSON.parse(await readFile(new URL('../data/sky.json', import.meta.url)));
  assert.equal(data.stars.length, 5044);
  assert.equal(new Set(data.stars.map((s) => s[0])).size, 5044);
  assert.equal(data.constellations.length, 88);
  const sirius = data.stars.find((s) => s[0] === 32349);
  assert.equal(sirius[5], '시리우스');
  assert.ok(sirius[1] > 101 && sirius[1] < 102 && sirius[2] < -16);
  for (const star of data.stars) {
    assert.ok(star.slice(1, 5).every(Number.isFinite));
    const at = altitudeAzimuth(star[1], star[2], new Date('2026-11-13T12:00:00Z'), OBSERVERS[0]);
    assert.ok(at.altitude >= -90 && at.altitude <= 90 && at.azimuth >= 0 && at.azimuth < 360);
  }
});
