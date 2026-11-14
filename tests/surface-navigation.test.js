import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, SphereGeometry, MeshBasicMaterial, Points, PointsMaterial, BufferGeometry, PerspectiveCamera, Vector3 } from '../vendor/three.module.min.js';
import { surfaceFrame, transferCamera, createSurfaceBridge, flightHeight, orbitHeight, SURFACE_RADIUS, SURFACE_CLEARANCE, ASCENT_TRIGGER, ORBIT_ALTITUDE } from '../src/surface-navigation.js';
import { surfaceProfile } from '../src/surface-world.js';
import { MAX_SOLAR_RELIEF } from '../src/solar-convection.js';

test('지표 좌표로 옮겨도 화면 위치·시선·화각이 이어지고 왕복 뒤 복원된다', () => {
  for (const normal of [new Vector3(1,2,3),new Vector3(0,1,0),new Vector3(0,0,1),new Vector3(-2,.3,1)]) {
    normal.normalize();const center=new Vector3(42,-3,61);
    const source=new PerspectiveCamera(49,1.7,.05,9000);source.position.copy(center).addScaledVector(normal,20);source.lookAt(center);source.updateMatrixWorld();
    const frame=surfaceFrame(center,normal,source.up,3.5),original=source.position.clone(),quaternion=source.quaternion.clone();
    const samples=[center.clone(),center.clone().add(new Vector3(1,.4,-.2))];
    const before=samples.map(p=>p.clone().project(source));
    const local=new PerspectiveCamera(67,1.7,.1,3e8);transferCamera(source,local,frame);
    samples.forEach((point,i)=>{const after=point.clone().applyMatrix4(frame).project(local);assert.ok(Math.abs(after.x-before[i].x)<1e-10);assert.ok(Math.abs(after.y-before[i].y)<1e-10);});
    assert.equal(local.fov,49);transferCamera(local,source,frame.clone().invert());
    assert.ok(source.position.distanceTo(original)<1e-10);assert.ok(source.quaternion.angleTo(quaternion)<1e-7);
  }
});

test('우주 자원을 재사용하고 공전 중심 추적 뒤 원래 부모·점 크기·광채를 복원한다', () => {
  const origin=new Scene(),destination=new Scene(),world=new Group(),body=new Group();origin.add(world);world.add(body);body.position.set(12,1,4);
  const target=new Mesh(new SphereGeometry(1),new MeshBasicMaterial());body.add(target);body.userData.nearVisibility={value:1};
  const effect=new Mesh(new SphereGeometry(2),new MeshBasicMaterial({transparent:true,opacity:.4}));body.add(effect);
  const background=new Points(new BufferGeometry(),new PointsMaterial({size:5}));origin.add(background);
  const camera=new PerspectiveCamera(49,1,.05,9000);camera.position.set(20,8,9);camera.lookAt(body.position);camera.updateMatrixWorld();const original=camera.position.clone();
  let disposed=0;target.geometry.addEventListener('dispose',()=>disposed++);
  const bridge=createSurfaceBridge({world,background,target,body,radius:1,camera,destination});
  const local=new PerspectiveCamera(67,1,.1,3e8);bridge.enter(local);
  body.position.add(new Vector3(1,2,-3));bridge.update(local,60,true);destination.updateMatrixWorld(true);
  assert.ok(target.getWorldPosition(new Vector3()).distanceTo(new Vector3(0,-SURFACE_RADIUS-SURFACE_CLEARANCE,0))<1e-7);
  assert.equal(body.userData.nearVisibility.value,0);assert.equal(effect.material.opacity,0);
  bridge.leave(local);bridge.restore();bridge.restore();
  assert.equal(world.parent,origin);assert.equal(background.parent,origin);assert.equal(background.material.size,5);
  assert.equal(effect.material.opacity,.4);assert.equal(body.userData.nearVisibility.value,1);assert.equal(disposed,0);
  assert.ok(camera.position.distanceTo(original.add(new Vector3(1,2,-3)))<1e-9);
});

test('상승·하강 경로는 끝점을 유지하고 진입 경계 밖으로 복귀하며 태양 요철은 안전 고도 아래다', () => {
  for(const [from,to]of[[2.2,ORBIT_ALTITUDE],[2000000,60],[60,2.2]]) {
    let previous=from;
    for(let i=0;i<=100;i++){const height=flightHeight(from,to,i/100);assert.ok(Number.isFinite(height));assert.ok(height>=Math.min(from,to)-1e-7&&height<=Math.max(from,to)+1e-7);assert.ok((to-from)*(height-previous)>=-1e-6);previous=height;}
    assert.ok(Math.abs(flightHeight(from,to,0)-from)<1e-7);assert.ok(Math.abs(flightHeight(from,to,1)-to)<1e-7);
  }
  assert.ok(ORBIT_ALTITUDE>ASCENT_TRIGGER);assert.ok((SURFACE_RADIUS+SURFACE_CLEARANCE+ORBIT_ALTITUDE)/SURFACE_RADIUS>3.1);
  assert.ok(surfaceProfile(null,{seed:'sol',real:true,color:'#ffe5b5'}).minimum>MAX_SOLAR_RELIEF);
});

test('세로 화면에서도 복귀한 천체가 폭 안에 들어오며 높은 곳에서 복귀해도 하강하지 않는다', () => {
  for (const aspect of [375/667,390/844,844/390,16/9]) {
    const height=orbitHeight(aspect,60),distance=height+SURFACE_RADIUS+SURFACE_CLEARANCE;
    const angle=Math.asin(SURFACE_RADIUS/distance),vertical=Math.tan(49*Math.PI/360);
    assert.ok(Math.tan(angle)<vertical*Math.min(1,aspect)*.8);
    assert.equal(orbitHeight(aspect,8000000),8000000);
  }
});
