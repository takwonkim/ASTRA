import test from 'node:test';
import assert from 'node:assert/strict';
import { galaxiesInSector, starAt, makeSystem } from '../src/universe.js';
import { surfaceProfile, terrainHeight, surfaceAltitude, moveOnSurface } from '../src/surface-world.js';

const star = starAt(galaxiesInSector()[0], 0), planets = makeSystem(star);

test('암석 행성은 착륙하고 태양과 네 거대 행성은 비행한다', () => {
  for (const planet of planets.slice(0,4)) assert.ok(surfaceProfile(planet,star).minimum < 3);
  for (const planet of planets.slice(4)) assert.equal(surfaceProfile(planet,star).kind,'gas');
  assert.equal(surfaceProfile(null,star).kind,'star');
  const generatedIce = { kind:'ice',seed:'sample/ice',name:'얼음',color:'#a7c5ce',real:false };
  assert.equal(surfaceProfile(generatedIce,star).kind,'ice');
});

test('착륙 지형은 주소로 재현되며 착륙점과 멀리 떨어진 곳에서도 유한하다', () => {
  for (const planet of planets) {
    const profile = surfaceProfile(planet,star);
    const again = surfaceProfile(planet,star);
    for (const [x,z] of [[0,0],[.001,.002],[150,-400],[-13000,13000],[1e6,-1e6]]) {
      const height=terrainHeight(profile,x,z);
      assert.ok(Number.isFinite(height));assert.equal(height,terrainHeight(again,x,z));
      assert.ok(Math.abs(terrainHeight(profile,x+.001,z)-height)<.1);
    }
  }
  assert.notEqual(terrainHeight(surfaceProfile(planets[0],star),400,500),terrainHeight(surfaceProfile(planets[3],star),400,500));
});

test('지표 및 플라스마·구름 아래로 내려가지 않도록 고도를 제한한다', () => {
  for (const planet of [null,...planets]) {
    const profile=surfaceProfile(planet,star);
    assert.equal(surfaceAltitude(profile,-100),profile.minimum);
    assert.equal(surfaceAltitude(profile,1e9),1e8);
    const position={x:0,z:0,altitude:profile.minimum,yaw:0};
    moveOnSurface(position,profile,1,0,-1,1);
    assert.equal(position.altitude,profile.minimum);
    assert.ok(terrainHeight(profile,position.x,position.z)+position.altitude>terrainHeight(profile,position.x,position.z));
  }
});

test('시선 방향으로 이동하며 대각선과 프레임 분할에 따라 속도가 달라지지 않는다', () => {
  const profile=surfaceProfile(planets[3],star);
  const start=()=>({x:0,z:0,altitude:2.2,yaw:Math.PI/2});
  const a=start(),b=start(),diagonal=start();
  moveOnSurface(a,profile,1,0,0,1);
  for(let i=0;i<60;i++)moveOnSurface(b,profile,1,0,0,1/60);
  assert.ok(Math.abs(a.x-profile.speed)<1e-10);assert.ok(Math.abs(a.z)<1e-10);
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-10);
  moveOnSurface(diagonal,profile,1,1,0,1);
  assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.z)-profile.speed)<1e-10);
});
