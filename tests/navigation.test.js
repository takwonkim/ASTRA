import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3, Quaternion, Euler, PerspectiveCamera } from '../vendor/three.module.min.js';
import { remapCamera, zoomBoundary, DETAIL_SCALE } from '../src/navigation.js';
import { blackHoleIn, galaxiesInSector } from '../src/universe.js';

test('좌표계가 바뀌어도 천체의 화면 위치와 크기가 유지된다', () => {
  const rotation = new Quaternion().setFromEuler(new Euler(.35, .8, .1));
  const from = new Matrix4().compose(new Vector3(62, 3, 48), rotation, new Vector3().setScalar(DETAIL_SCALE));
  const to = new Matrix4().compose(new Vector3(), rotation, new Vector3(1, 1, 1));
  const camera = new PerspectiveCamera(49, 1.7, .001, 90000);
  camera.position.set(65, 9, 60);
  const target = new Vector3(62, 3, 48);
  camera.lookAt(target); camera.updateMatrixWorld();
  const points = [new Vector3(), new Vector3(3.5, 0, 0), new Vector3(0, 0, 12)];
  const before = points.map((p) => p.clone().applyMatrix4(from).project(camera));
  const original = camera.position.clone();
  remapCamera(camera, target, from, to);
  camera.lookAt(target); camera.updateMatrixWorld();
  points.forEach((point, index) => {
    const after = point.clone().applyMatrix4(to).project(camera);
    assert.ok(Math.abs(after.x - before[index].x) < 1e-10);
    assert.ok(Math.abs(after.y - before[index].y) < 1e-10);
  });
  remapCamera(camera, target, to, from);
  assert.ok(camera.position.distanceTo(original) < 1e-10);
});

test('확대와 축소 경계 사이의 여유 구간은 자동 왕복을 방지한다', () => {
  assert.equal(zoomBoundary('cluster', 150, 1, 48), 'galaxy');
  assert.equal(zoomBoundary('galaxy', 150 / 48 * 150, -1), null);
  assert.equal(zoomBoundary('galaxy', 7.9, 1), 'detail');
  assert.equal(zoomBoundary('system', 7.9 / DETAIL_SCALE, -1), null);
  assert.equal(zoomBoundary('system', 286, -1), 'galaxy');
  assert.equal(zoomBoundary('galaxy', 286 * DETAIL_SCALE, 1), null);
  assert.equal(zoomBoundary('galaxy', 621, -1), 'cluster');
  assert.equal(zoomBoundary('blackhole', 286, -1), 'galaxy');
});

test('궁수자리 A*와 생성 블랙홀을 구분하고 같은 주소를 재현한다', () => {
  const galaxies = galaxiesInSector();
  const actual = blackHoleIn(galaxies[0]);
  assert.equal(actual.name, '궁수자리 A*');
  assert.equal(actual.real, true);
  assert.equal(actual.mass, 4e6);
  assert.ok(actual.radiusAU > .07 && actual.radiusAU < .09);
  for (const galaxy of galaxies.slice(1)) {
    assert.equal(blackHoleIn(galaxy).real, false);
    assert.deepEqual(blackHoleIn(galaxy), blackHoleIn(galaxy));
  }
});
