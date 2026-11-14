import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK_HOLE as BH, arealRadius, refractiveIndex, traceReference, frequencyShift } from '../src/black-hole-math.js';

function incoming(impact) {
  const z = 80, s = impact / (z * refractiveIndex(z));
  return traceReference([0, 0, z], [s, 0, -Math.sqrt(1 - s * s)], false);
}

test('비회전 블랙홀의 광자 구면과 광선 포획 경계가 해석값과 맞는다', () => {
  assert.ok(Math.abs(arealRadius(BH.photon) - 1.5) < 1e-12);
  assert.equal(incoming(BH.criticalImpact * .997).event, 'captured');
  assert.equal(incoming(BH.criticalImpact * 1.003).event, 'escaped');
});

test('휘어진 광선이 구대칭 계량의 충돌 매개변수를 보존한다', () => {
  for (const impact of [3, 5, 10]) {
    const ray = incoming(impact);
    assert.equal(ray.event, 'escaped');
    const [x, y, z] = ray.position, [dx, dy, dz] = ray.direction;
    const measured = refractiveIndex(Math.hypot(x, y, z)) * Math.hypot(y * dz - z * dy, z * dx - x * dz, x * dy - y * dx);
    assert.ok(Math.abs(measured / impact - 1) < .004, `${impact}: ${measured}`);
  }
});

test('원반 뒤쪽에서 시작한 광선이 휘어 원반에 다시 닿고 위아래가 대칭이다', () => {
  const origin = [0, 12, 40], direction = [0, -8, -40];
  const above = traceReference(origin, direction), below = traceReference(origin.map((v, i) => i === 1 ? -v : v), direction.map((v, i) => i === 1 ? -v : v));
  assert.equal(above.event, 'disk');
  assert.equal(below.event, 'disk');
  assert.ok(above.position[2] < 0);
  assert.ok(Math.abs(above.position[2] - below.position[2]) < 1e-10);
});

test('원반의 접근 쪽이 밝아지고 정면에서는 좌우 도플러 비대칭이 사라진다', () => {
  const p = [5, 0, 0];
  assert.ok(frequencyShift(p, [0, 0, -1]) > frequencyShift(p, [0, 0, 1]));
  assert.equal(frequencyShift(p, [0, -1, 0]), frequencyShift([-5, 0, 0], [0, -1, 0]));
  assert.ok(frequencyShift(p, [0, -1, 0]) < 1);
});
