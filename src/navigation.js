import { Matrix4 } from '../vendor/three.module.min.js';

export const DETAIL_SCALE = 0.04;

// 관측 좌표계만 바꾸고 화면에서 보이는 위치·각도·크기는 유지한다.
export function remapCamera(camera, target, fromFrame, toFrame) {
  const transform = new Matrix4().multiplyMatrices(toFrame, fromFrame.clone().invert());
  camera.position.applyMatrix4(transform);
  target.applyMatrix4(transform);
  camera.up.transformDirection(transform);
  camera.updateMatrixWorld();
}

export function zoomBoundary(view, distance, direction, radius = 1) {
  if (direction > 0 && view === 'cluster' && distance < radius * 3.3) return 'galaxy';
  if (direction > 0 && view === 'galaxy' && distance < 8) return 'detail';
  if (direction < 0 && view === 'galaxy' && distance > 620) return 'cluster';
  if (direction < 0 && (view === 'system' || view === 'blackhole') && distance > 285) return 'galaxy';
  return null;
}
