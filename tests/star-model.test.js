import test from 'node:test';
import assert from 'node:assert/strict';
import { stellarProfile, layerAtRadius, insideStellarCut, stellarZoomBoundary } from '../src/star-model.js';
import { galaxiesInSector, starAt } from '../src/universe.js';

test('태양의 핵·복사층·대류층과 강조한 광구를 구분한다', () => {
  const profile = stellarProfile(starAt(galaxiesInSector()[0], 0));
  assert.equal(profile.sun, true);
  assert.equal(layerAtRadius(profile, 0).id, 'core');
  assert.equal(layerAtRadius(profile, .26).id, 'radiative');
  assert.equal(layerAtRadius(profile, .71).id, 'convective');
  assert.equal(layerAtRadius(profile, 1).id, 'photosphere');
  assert.equal(layerAtRadius(profile, 2).id, 'photosphere');
});

test('작은 적색왜성에는 복사층을 만들지 않고 무거운 별은 대류핵을 쓴다', () => {
  const small = stellarProfile({ mass: .3, color: '#ffb07c' });
  assert.ok(small.layers.slice(0, -1).every((layer) => layer.transport === '대류'));
  assert.equal(small.layers.some((layer) => layer.id === 'radiative'), false);
  const large = stellarProfile({ mass: 5, color: '#c3d8ff' });
  assert.equal(large.layers[0].transport, '대류');
  assert.equal(large.layers[1].transport, '복사');
  assert.equal(large.layers.some((layer) => layer.id === 'convective'), false);
  const transition = stellarProfile({ mass: 1.3, color: '#f1f0ff' });
  assert.deepEqual(transition.layers.map((layer) => layer.transport), ['대류', '복사', '대류', '빛의 방출']);
});

test('실제 생성 항성의 모든 구조에서 층 경계는 순서가 있고 중심까지 탐색된다', () => {
  const galaxy = galaxiesInSector()[0];
  for (let i = 0; i < 300; i++) {
    const profile = stellarProfile(starAt(galaxy, i));
    assert.ok(profile.layers.length <= 4);
    profile.layers.forEach((layer, index) => assert.ok(layer.radius > (profile.layers[index - 1]?.radius || 0)));
    assert.equal(profile.layers.at(-1).radius, 1);
    for (let radius = 0; radius <= 1; radius += .01) assert.ok(layerAtRadius(profile, radius));
  }
});

test('잘린 앞쪽의 표면은 선택하지 않고 뒤쪽과 옆쪽은 남긴다', () => {
  for (const angle of [0, .7, Math.PI, -2.5]) {
    assert.equal(insideStellarCut(Math.cos(angle), Math.sin(angle), angle, 1), true);
    assert.equal(insideStellarCut(-Math.cos(angle), -Math.sin(angle), angle, 1), false);
    assert.equal(insideStellarCut(-Math.sin(angle), Math.cos(angle), angle, 1), false);
    assert.equal(insideStellarCut(Math.cos(angle), Math.sin(angle), angle, 0), false);
  }
});

test('내부 진입과 복귀는 방향·화면 폭·여유 구간을 반영한다', () => {
  assert.equal(stellarZoomBoundary(false, 3, 1, 1.7), 'inside');
  assert.equal(stellarZoomBoundary(false, 3, -1, 1.7), null);
  assert.equal(stellarZoomBoundary(true, 3, -1, 1.7), null);
  assert.equal(stellarZoomBoundary(true, 5.6, -1, 1.7), 'outside');
  assert.equal(stellarZoomBoundary(true, 8.3, -1, 390 / 844), null);
  assert.equal(stellarZoomBoundary(true, 12, -1, 390 / 844), 'outside');
});
