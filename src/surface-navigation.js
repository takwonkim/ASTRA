import { Group, Matrix4, Vector3, MathUtils } from '../vendor/three.module.min.js';

export const SURFACE_RADIUS = 60000;
export const SURFACE_CLEARANCE = 500;
export const ASCENT_TRIGGER = 12000;
export const ORBIT_ALTITUDE = SURFACE_RADIUS * 3.2;

export function orbitHeight(aspect, currentAltitude) {
  const distance = (SURFACE_RADIUS + SURFACE_CLEARANCE + ORBIT_ALTITUDE) * Math.max(1, 1 / aspect);
  return Math.max(currentAltitude, distance - SURFACE_RADIUS - SURFACE_CLEARANCE);
}

export function surfaceFrame(center, normal, cameraUp, radius) {
  const y = normal.clone().normalize();
  const z = cameraUp.clone().addScaledVector(y, -cameraUp.dot(y));
  if (z.lengthSq() < .0001) z.set(0, 0, 1).addScaledVector(y, -y.z);
  if (z.lengthSq() < .0001) z.set(1, 0, 0);
  z.normalize().negate();
  const x = new Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y);
  const basis = new Matrix4().makeBasis(x, y, z).setPosition(center).invert();
  return new Matrix4().makeTranslation(0, -SURFACE_RADIUS - SURFACE_CLEARANCE, 0)
    .multiply(new Matrix4().makeScale(SURFACE_RADIUS / radius, SURFACE_RADIUS / radius, SURFACE_RADIUS / radius)).multiply(basis);
}

export function transferCamera(from, to, transform) {
  from.updateMatrixWorld();
  const pose = new Matrix4().multiplyMatrices(transform, from.matrixWorld);
  pose.decompose(to.position, to.quaternion, new Vector3());
  to.up.set(0, 1, 0).applyQuaternion(to.quaternion);
  to.fov = from.fov;
  to.updateProjectionMatrix();to.updateMatrixWorld();
}

export function flightHeight(from, to, progress) {
  const t = Math.max(0, Math.min(1, progress));
  const ease = t * t * (3 - 2 * t);
  return Math.exp(MathUtils.lerp(Math.log(from + 800), Math.log(to + 800), ease)) - 800;
}

// 우주 장면을 지표 좌표로 옮겼다가 같은 자원과 좌표로 돌려놓는다.
export function createSurfaceBridge({ world, background, target, body, radius, camera, destination }) {
  const parent = world.parent, backgroundParent = background.parent;
  world.updateWorldMatrix(true, true);
  const center = target.getWorldPosition(new Vector3());
  const normal = camera.position.clone().sub(center).normalize();
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const frame = new Group();frame.matrixAutoUpdate = false;
  frame.matrix.copy(surfaceFrame(center, normal, up, radius));
  const inverse = frame.matrix.clone().invert();
  const points = [], effects = [];
  for (const root of [world, background]) root.traverse((object) => {
    if (object.material?.isPointsMaterial) { points.push([object.material, object.material.size]);object.material.size *= SURFACE_RADIUS / radius; }
  });
  body.traverse((object) => {
    const material = object.material;
    if (material?.transparent) effects.push({ material, opacity: material.opacity, uniform: material.uniforms?.opacity, alpha: material.uniforms?.opacity?.value });
  });
  destination.add(frame);frame.add(world, background);
  let attached = true;
  return {
    frame,
    enter(eye) { transferCamera(camera, eye, frame.matrix); },
    update(eye, altitude, stellar) {
      target.updateWorldMatrix(true, false);
      center.copy(target.getWorldPosition(new Vector3())).applyMatrix4(inverse);
      frame.matrix.copy(surfaceFrame(center, normal, up, radius));inverse.copy(frame.matrix).invert();
      frame.matrixWorldNeedsUpdate = true;
      background.position.copy(eye.position).applyMatrix4(inverse);
      const visibility = MathUtils.smoothstep(altitude, stellar ? SURFACE_RADIUS * .65 : 1200, stellar ? SURFACE_RADIUS * 1.3 : 10000);
      for (const effect of effects) { effect.material.opacity = effect.opacity * visibility;if (effect.uniform) effect.uniform.value = effect.alpha * visibility; }
      if (body.userData.nearVisibility) body.userData.nearVisibility.value = visibility;
    },
    leave(eye) { transferCamera(eye, camera, inverse); },
    restore() {
      if (!attached) return;
      attached = false;parent.add(world);backgroundParent.add(background);frame.removeFromParent();
      for (const [material, size] of points) material.size = size;
      for (const effect of effects) { effect.material.opacity = effect.opacity;if (effect.uniform) effect.uniform.value = effect.alpha; }
      if (body.userData.nearVisibility) body.userData.nearVisibility.value = 1;
    }
  };
}
