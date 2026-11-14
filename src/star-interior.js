import * as THREE from 'three';
import { stellarProfile, layerAtRadius, insideStellarCut } from './star-model.js?v=9';

export const cutawayShader = `
  uniform float opening;uniform vec3 cutDirection;
  bool removed(vec3 point){float forward=dot(point,cutDirection);
    float sideways=dot(point,vec3(-cutDirection.z,0.,cutDirection.x));
    return opening>.001&&forward>0.&&abs(sideways)<forward*tan(opening*1.04719755);}
`;

const plasmaShader = `
  float hash(vec3 p){p=fract(p*.3183+vec3(.17,.31,.73));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float plasma(vec3 p,float convective,float time){
    vec3 flow=p*24.+vec3(sin(p.y*9.+time)*.5,time*.6,cos(p.x*8.-time)*.5);
    float cells=noise(flow)*.7+noise(flow*2.1)*.3;
    float ripples=sin(length(p)*95.-time*1.8)*.5+.5;
    return mix(.84+cells*.28+ripples*.035,.54+pow(cells,1.5)*1.05,convective);}
`;

export function attachStarInterior(visual, star) {
  if (visual.userData.interior) return visual.userData.interior;
  const profile = stellarProfile(star), layers = profile.layers;
  const root = new THREE.Group();
  root.visible = false;
  const cutaway = visual.userData.cutaway;
  const time = { value: 0 }, selected = { value: 0 };
  const uniforms = { ...cutaway, time, selected,
    bounds: { value: new THREE.Vector4(...Array.from({ length: 4 }, (_, i) => layers[i]?.radius ?? 2)) },
    colors: { value: Array.from({ length: 4 }, (_, i) => new THREE.Color(layers[i]?.color || '#ffffff')) },
    convection: { value: new THREE.Vector4(...Array.from({ length: 4 }, (_, i) => layers[i]?.transport === '대류' ? 1 : 0)) }
  };
  const vertexShader = 'varying vec3 p;void main(){p=position/3.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
  const faces = [];
  // 두 절단면은 별의 중심을 포함하는 반원이다.
  const points = [0, 0, 0];
  for (let i = 0; i <= 128; i++) {
    const theta = -Math.PI / 2 + i / 128 * Math.PI;
    points.push(Math.cos(theta) * 3.5, Math.sin(theta) * 3.5, 0);
  }
  const indices = [];
  for (let i = 1; i <= 128; i++) indices.push(0, i, i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({ uniforms, side: THREE.DoubleSide, vertexShader,
    fragmentShader: `${plasmaShader}
      uniform float time;uniform int selected;uniform vec4 bounds;uniform vec3 colors[4];uniform vec4 convection;varying vec3 p;
      void main(){float radius=length(p);if(radius<bounds.x)discard;int layer=1;
        if(radius>bounds.y)layer=2;if(radius>bounds.z)layer=3;
        float outer=bounds[layer];float inner=bounds[layer-1];
        float edge=1.-smoothstep(.002,.009,min(abs(radius-outer),abs(radius-inner)));
        float bright=plasma(p,convection[layer],time);
        vec3 color=colors[layer]*bright;
        color+=colors[layer]*edge*.3;
        if(layer==selected)color+=vec3(1.,.78,.42)*edge*.4;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  for (let i = 0; i < 2; i++) {
    const face = new THREE.Mesh(geometry, material);
    faces.push(face); root.add(face);
  }
  const shells = layers.slice(0, -1).map((layer, index) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.5 * layer.radius, 48, 32), new THREE.ShaderMaterial({
      uniforms: { ...cutaway, time, selected, tint: { value: new THREE.Color(layer.color) }, convective: { value: layer.transport === '대류' ? 1 : 0 }, layerIndex: { value: index } },
      vertexShader, side: THREE.DoubleSide,
      fragmentShader: `${cutawayShader}${plasmaShader}
        uniform float time;uniform int selected;uniform int layerIndex;uniform vec3 tint;uniform float convective;varying vec3 p;
        void main(){if(layerIndex!=0&&removed(p))discard;
          float shade=.35+.65*max(0.,dot(normalize(p),normalize(cutDirection+vec3(0.,.8,0.))));
          vec3 color=tint*plasma(p,convective,time)*shade*(layerIndex==0?1.15:1.);
          if(selected==layerIndex)color*=1.05;
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    mesh.userData.layer = layer.id;
    root.add(mesh);
    return mesh;
  });
  visual.add(root);
  const effects = visual.children.filter((child) => child !== root && child.material?.transparent && !child.material.isShaderMaterial).map((child) => ({ material: child.material, opacity: child.material.opacity }));
  let active = false, angle = 0;
  const local = new THREE.Vector3();
  // Raycaster은 셰이더의 버린 조각을 모르므로 같은 절단 조건으로 걸러낸다.
  for (const mesh of [visual.userData.surface, ...shells.slice(1)]) {
    mesh.raycast = function (raycaster, hits) {
      const candidates = [];
      THREE.Mesh.prototype.raycast.call(this, raycaster, candidates);
      for (const hit of candidates) {
        visual.worldToLocal(local.copy(hit.point));
        if (!insideStellarCut(local.x, local.z, angle, cutaway.opening.value)) hits.push(hit);
      }
    };
  }
  const model = {
    profile, pickables: [...faces, ...shells, visual.userData.surface],
    setActive(value) { active = value; if (value) root.visible = true; },
    reset() { active = false; root.visible = false; cutaway.opening.value = 0; effects.forEach((effect) => { effect.material.opacity = effect.opacity; }); },
    resetTime() { time.value = 0; },
    select(id) { selected.value = Math.max(0, layers.findIndex((layer) => layer.id === id)); },
    layerAtPoint(point) { return layerAtRadius(profile, visual.worldToLocal(point.clone()).length() / 3.5); },
    update(camera, dt, motion = dt) {
      cutaway.opening.value = THREE.MathUtils.damp(cutaway.opening.value, active ? 1 : 0, 8, dt);
      if (!active && cutaway.opening.value < .001) { cutaway.opening.value = 0; root.visible = false; }
      time.value += motion * .65;
      visual.updateWorldMatrix(true, false);
      visual.worldToLocal(local.copy(camera.position));
      if (Math.hypot(local.x, local.z) > .001) angle = Math.atan2(local.z, local.x) + .5;
      cutaway.cutDirection.value.set(Math.cos(angle), 0, Math.sin(angle));
      faces.forEach((face, i) => { face.rotation.y = -(angle + (i ? 1 : -1) * cutaway.opening.value * Math.PI / 3); });
      effects.forEach((effect) => { effect.material.opacity = effect.opacity * (1 - cutaway.opening.value); });
    }
  };
  visual.userData.interior = model;
  return model;
}
