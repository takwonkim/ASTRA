import test from 'node:test';
import assert from 'node:assert/strict';
import { createTapTracker } from '../src/tap.js';

const point = (clientX, clientY = 0, pointerId = 1) => ({ clientX, clientY, pointerId });

test('크게 움직였다 시작점으로 돌아와도 탭으로 선택하지 않는다', () => {
  const tap = createTapTracker();
  tap.start(point(0)); tap.move(point(100)); tap.move(point(0));
  assert.equal(tap.finish(point(0)), false);
  tap.start(point(0)); tap.move(point(3, 2));
  assert.equal(tap.finish(point(2, 1)), true);
});

test('합쳐진 포인터 이동 표본의 왕복 경로도 검사한다', () => {
  const tap = createTapTracker();
  tap.start(point(0));
  tap.move({ ...point(0), getCoalescedEvents: () => [point(80), point(0)] });
  assert.equal(tap.finish(point(0)), false);
});

test('핀치·취소 뒤에는 선택하지 않고 다음 단일 탭은 처리한다', () => {
  const tap = createTapTracker();
  tap.start(point(0)); tap.start(point(20, 0, 2));
  assert.equal(tap.finish(point(0)), false);
  assert.equal(tap.finish(point(20, 0, 2)), false);
  tap.start(point(0)); tap.cancel(point(0));
  assert.equal(tap.finish(point(0)), false);
  tap.start(point(0));
  assert.equal(tap.finish(point(0)), true);
});
