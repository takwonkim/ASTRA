// 길이는 슈바르츠실트 반지름 Rs=1, 공간 위치는 등방 좌표로 계산한다.
export const BLACK_HOLE = Object.freeze({ scale: 1.35, horizon: .25, capture: .275, photon: (2 + Math.sqrt(3)) / 4, criticalImpact: 1.5 * Math.sqrt(3), inner: 3, outer: 14, escape: 40, steps: 256 });
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const add = (a, b, scale = 1) => a.map((v, i) => v + b[i] * scale);
const norm = (v) => { const r = Math.hypot(...v); return v.map((x) => x / r); };

export function arealRadius(rho) { return rho * (1 + .25 / rho) ** 2; }
export function refractiveIndex(rho) { return (1 + .25 / rho) ** 3 / (1 - .25 / rho); }
export function opticalGradient(position) {
  const r = Math.hypot(...position);
  const factor = -.25 * (3 / (r + .25) + 1 / (r - .25)) / (r * r);
  return position.map((v) => v * factor);
}
export function rayStep(position, direction) {
  const r = Math.hypot(...position), h = r > 8 ? .1 * r : .07 * (r - .25);
  const g = opticalGradient(position), bend = add(g, direction, -dot(g, direction));
  const midpoint = add(position, direction, h / 2), midDirection = norm(add(direction, bend, h / 2));
  const gm = opticalGradient(midpoint), bm = add(gm, midDirection, -dot(gm, midDirection));
  return { position: add(position, midDirection, h), direction: norm(add(direction, bm, h)) };
}

export function frequencyShift(position, backwardDirection) {
  const rho = Math.hypot(...position), radius = arealRadius(rho);
  const tangent = norm([-position[2], 0, position[0]]);
  const beta = Math.sqrt(1 / (2 * (radius - 1)));
  return Math.sqrt(1 - 1 / radius) * Math.sqrt(1 - beta * beta) / (1 + beta * dot(tangent, backwardDirection));
}

// GPU 적분식의 포획 경계·편향·대칭성을 기준값과 비교한다.
export function traceReference(origin, initialDirection, disk = true) {
  let position = [...origin], direction = norm(initialDirection), entered = Math.hypot(...position) < BLACK_HOLE.escape;
  for (let step = 0; step < BLACK_HOLE.steps; step++) {
    const radius = Math.hypot(...position);
    if (radius < BLACK_HOLE.capture) return { event: 'captured', position, direction, step };
    if (radius < BLACK_HOLE.escape) entered = true;
    if (entered && radius > BLACK_HOLE.escape && dot(position, direction) > 0) return { event: 'escaped', position, direction, step };
    const next = rayStep(position, direction);
    if (disk && position[1] * next.position[1] <= 0 && Math.abs(next.position[1] - position[1]) > 1e-8) {
      const t = -position[1] / (next.position[1] - position[1]);
      const hit = add(position, add(next.position, position, -1), t), r = arealRadius(Math.hypot(...hit));
      if (r >= BLACK_HOLE.inner && r <= BLACK_HOLE.outer) return { event: 'disk', position: hit, direction: norm(add(direction, add(next.direction, direction, -1), t)), step };
    }
    position = next.position; direction = next.direction;
  }
  return { event: 'limit', position, direction, step: BLACK_HOLE.steps };
}
