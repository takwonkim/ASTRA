import * as THREE from 'three';
import { random } from './universe.js?v=3';
import { surfaceProfile, terrainHeight, surfaceAltitude, moveOnSurface } from './surface-world.js?v=11';
import { solarConvectionShader } from './solar-convection.js?v=11';
import { SURFACE_RADIUS, SURFACE_CLEARANCE, ASCENT_TRIGGER, orbitHeight, flightHeight } from './surface-navigation.js?v=11';

const noiseShader = `
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
  float fbm(vec2 p){return noise(p)*.55+noise(p*2.03)*.27+noise(p*4.07)*.12+noise(p*8.13)*.06;}
`;

export function createSurfaceMode({ planet, star, aspect, input, buttons, reduceMotion = false, blocked = () => false }) {
  const profile = surfaceProfile(planet, star), scene = new THREE.Scene();
  const content = new THREE.Group();scene.add(content);
  const camera = new THREE.PerspectiveCamera(67, aspect, .1, 30000);
  camera.layers.enable(1);
  const position = { x: 0, z: 320, altitude: 1600, yaw: 0, pitch: -.5 };
  const eye = { value: camera.position }, time = { value: 0 };
  const radius = { value: 0 }, visibility = { value: 1 }, skyVisibility = { value: 1 };
  const tint = new THREE.Color(profile.ground), haze = new THREE.Color(profile.sky);
  const sun = new THREE.Vector3(-.48, .53, -.7).normalize();
  const uniforms = { eye, time, radius, visibility, tint: { value: tint }, dark: { value: new THREE.Color(profile.dark) }, haze: { value: haze },
    sun: { value: sun }, kind: { value: ['rock', 'desert', 'ocean', 'ice', 'lava', 'gas', 'star'].indexOf(profile.kind) }, fogDensity: { value: profile.haze } };
  const terrainMaterial = new THREE.ShaderMaterial({ uniforms, transparent: true,
    vertexShader: `${noiseShader}${solarConvectionShader} uniform float time,radius;uniform int kind;varying vec3 point;varying vec3 normalAt;
      void main(){point=position;normalAt=normal;if(kind==6){vec2 slope;point.y+=solarCell(point.xz,time,slope).x;}
        if(radius>0.)point.y-=dot(point.xz,point.xz)/(2.*radius);gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);}`,
    fragmentShader: `${noiseShader}${solarConvectionShader}
      uniform vec3 eye,tint,dark,haze,sun;uniform float time,fogDensity,visibility;uniform int kind;varying vec3 point,normalAt;
      void main(){vec2 p=point.xz;vec3 n=normalize(normalAt);float detail=fbm(p*.7),broad=fbm(p*.009);
        vec3 color=mix(dark,tint,.25+broad*.75);float grain=.76+detail*.45;
        n=normalize(n+vec3(noise(p*.6)-.5,0.,noise(p*.6+7.)-.5)*.28);
        if(kind==2){float slope=1.-n.y;color=mix(vec3(.19,.27,.10),vec3(.27,.25,.20),smoothstep(.08,.45,slope));
          color=mix(color,vec3(.50,.44,.30),1.-smoothstep(-3.,16.,point.y));}
        if(kind==3){float cracks=pow(1.-abs(noise(p*.022)*2.-1.),22.);color=mix(color,vec3(.09,.25,.34),cracks*.7);}
        vec3 emission=vec3(0.);
        if(kind==4){float fissure=1.-smoothstep(.015,.055,abs(fbm(p*.025)-.48));emission=vec3(3.5,.65,.06)*fissure*(.8+.2*sin(time+p.x*.03));}
        if(kind==5){float bands=sin(p.y*.006+fbm(p*.001+time*.008)*5.),billows=fbm(p*.008+vec2(time*.025,0.));
          color=mix(tint*.7,vec3(1.,.94,.85),smoothstep(.25,.75,billows));color*=.88+bands*.12;
          grain=.92+billows*.15;n=normalize(normalAt+vec3(noise(p*.008)-.5,0.,noise(p*.008+7.)-.5)*.3);}
        if(kind==6){vec2 slope;vec4 cell=solarCell(p,time,slope);n=normalize(vec3(-slope.x,1.,-slope.y));
          float temperature=.65+cell.z*.35+noise(p*.12+time*.2)*.12;
          color=mix(tint*(2.8+cell.w*2.5),tint*.48,cell.y)*temperature;
          color*=.58+.42*max(0.,dot(n,normalize(eye-point)));
        }else color*=grain*(kind==5?.65+max(0.,dot(n,sun))*.55:.19+max(0.,dot(n,sun))*1.12);
        color+=emission;float distance=length(point-eye);float fog=1.-exp(-distance*fogDensity);
        color=mix(color,haze*(kind==6?.45:1.),fog);
        gl_FragColor=vec4(color,visibility);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const segments = 192, vertices = [], indices = [];
  for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
    const coordinate = (i) => Math.sign(i / segments * 2 - 1) * Math.abs(i / segments * 2 - 1) ** 2.3 * 13000;
    vertices.push(coordinate(x), 0, coordinate(z));
  }
  for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
    const a = z * (segments + 1) + x, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices);
  const terrain = new THREE.Mesh(geometry, terrainMaterial);content.add(terrain);
  let centerX = Infinity, centerZ = Infinity;
  function updateTerrain() {
    centerX = Math.round(position.x / 256) * 256; centerZ = Math.round(position.z / 256) * 256;
    const points = geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const x = vertices[i * 3] + centerX, z = vertices[i * 3 + 2] + centerZ;
      points.setXYZ(i, x, terrainHeight(profile, x, z), z);
    }
    points.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  }
  updateTerrain();

  const sky = new THREE.Mesh(new THREE.SphereGeometry(22000, 40, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: { haze: { value: haze }, sun: { value: sun }, time, skyVisibility, cloudCover: { value: profile.clouds }, airless: { value: profile.airless || profile.kind === 'star' ? 1 : 0 } },
    vertexShader: 'varying vec3 direction;void main(){direction=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `${noiseShader} uniform vec3 haze,sun;uniform float time,airless,cloudCover,skyVisibility;varying vec3 direction;
      void main(){vec3 d=normalize(direction);float horizon=pow(1.-max(0.,d.y),3.);
        vec3 color=mix(haze*.28,haze*1.3,horizon);float clouds=smoothstep(.52,.75,fbm(d.xz/max(.1,d.y)*1.5+time*.003));
        color=mix(color,vec3(.72,.76,.78),clouds*cloudCover*smoothstep(.0,.18,d.y));
        float glow=pow(max(0.,dot(d,sun)),22.);color+=vec3(1.,.8,.5)*glow*.4*(1.-airless*.8);
        if(airless>.5){vec2 cell=floor(d.xz/max(.12,abs(d.y))*1300.);float star=step(.9995,hash(cell));color+=vec3(.5,.6,.8)*star*smoothstep(.05,.25,d.y);}
        gl_FragColor=vec4(color,skyVisibility);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));sky.renderOrder = -100;content.add(sky);
  const light = new THREE.DirectionalLight(new THREE.Color(star.color).lerp(new THREE.Color('white'), .8), 2.5);
  light.position.copy(sun).multiplyScalar(10000);content.add(light,new THREE.AmbientLight('#b0bdd1',.9));
  if (profile.kind !== 'star') {
    const disk = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(star.color).multiplyScalar(4) }));
    disk.position.copy(sun).multiplyScalar(12000);sky.add(disk);
  }

  let rocks;
  const obstacles = [];
  if (!['gas', 'star'].includes(profile.kind)) {
    const rng = random(`${profile.seed}/rocks`);
    const rockGeometry = new THREE.IcosahedronGeometry(1, 2);
    const points = rockGeometry.attributes.position;
    for(let i=0;i<points.count;i++) {const x=points.getX(i),y=points.getY(i),z=points.getZ(i),r=1+Math.sin(x*11+y*7+z*9)*.12;points.setXYZ(i,x*r,y*r,z*r);}
    const rockMaterial = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(.8), roughness: 1, transparent: true });
    rockMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.surfaceRadius = radius;
      shader.vertexShader = 'uniform float surfaceRadius;\n' + shader.vertexShader.replace('#include <project_vertex>', THREE.ShaderChunk.project_vertex.replace('mvPosition = modelViewMatrix * mvPosition;', 'if(surfaceRadius>0.)mvPosition.y-=dot(mvPosition.xz,mvPosition.xz)/(2.*surfaceRadius);\nmvPosition = modelViewMatrix * mvPosition;'));
    };
    rockMaterial.customProgramCacheKey = () => 'surface-curved-rock';
    rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 260);rocks.renderOrder = 1;
    const matrix = new THREE.Object3D();
    for (let i = 0; i < rocks.count; i++) {
      const angle = rng() * Math.PI * 2, radius = 12 + rng() ** 2 * 1300;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius, size = .15 + rng() ** 3 * 5;
      matrix.position.set(x, terrainHeight(profile, x, z) - Math.min(3, radius * .004), z);
      matrix.rotation.set(rng() * 3, rng() * 6, rng() * 3);matrix.scale.set(size * 1.4, size * .7, size);
      matrix.updateMatrix();rocks.setMatrixAt(i,matrix.matrix);
      if(size>.6)obstacles.push({x,z,radius:size*1.55,top:matrix.position.y+size*1.3});
    }
    content.add(rocks);
  }
  if (profile.kind === 'ocean') {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(26000,26000), new THREE.ShaderMaterial({
      uniforms: { eye, time, radius, visibility, sun: { value: sun } }, transparent: true,
      vertexShader: 'uniform float radius;varying vec3 p;void main(){p=position;vec4 world=modelMatrix*vec4(position,1.);if(radius>0.)world.y-=dot(world.xz,world.xz)/(2.*radius);gl_Position=projectionMatrix*viewMatrix*world;}',
      fragmentShader: `${noiseShader} uniform float time,visibility;uniform vec3 eye,sun;varying vec3 p;
        void main(){float wave=fbm(p.xy*.05+vec2(time*.1,0.));vec3 color=mix(vec3(.025,.10,.14),vec3(.07,.25,.32),wave);
          gl_FragColor=vec4(color, .94*visibility);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));water.rotation.x=-Math.PI/2;water.position.y=-4;content.add(water);
  }
  if (profile.kind === 'star') {
    const rng = random(`${profile.seed}/prominences`);
    for (let i = 0; i < 9; i++) {
      const angle = i === 0 ? -Math.PI / 2 : rng() * Math.PI * 2;
      const distance = i === 0 ? 900 : 500 + rng() * 1500, width = i === 0 ? 160 : 90 + rng() * 170, height = width * (1.4 + rng());
      const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
      const points = Array.from({ length: 49 }, (_, j) => { const t=j/48*Math.PI;return new THREE.Vector3(x+Math.cos(t)*width+Math.sin(t*5)*width*.05,terrainHeight(profile,x,z)+Math.sin(t)*height,z+Math.sin(t*2)*width*.15); });
      const curve = new THREE.CatmullRomCurve3(points), tube = new THREE.TubeGeometry(curve,64,18,8,false);
      const tubePoints = tube.attributes.position;
      for(let j=0;j<=64;j++){const center=curve.getPointAt(j/64),width=.35+.65*Math.sin(j/64*Math.PI)*(1+.25*Math.sin(j*.8));for(let k=0;k<=8;k++){const at=j*9+k;const point=new THREE.Vector3().fromBufferAttribute(tubePoints,at).sub(center).multiplyScalar(width).add(center);tubePoints.setXYZ(at,point.x,point.y,point.z);}}
      const loop = new THREE.Mesh(tube,new THREE.ShaderMaterial({
        uniforms:{time,radius,visibility,tint:{value:tint}},transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,
        vertexShader:'uniform float radius;varying vec3 p,n,eye;void main(){p=position;n=normalize(normalMatrix*normal);vec3 bent=position;if(radius>0.)bent.y-=dot(bent.xz,bent.xz)/(2.*radius);vec4 mv=modelViewMatrix*vec4(bent,1.);eye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
        fragmentShader:`${noiseShader} uniform float time,visibility;uniform vec3 tint;varying vec3 p,n,eye;
          void main(){float density=smoothstep(.28,.72,fbm(p.xy*.045+vec2(0.,-time*.25)));float rim=pow(abs(dot(normalize(n),normalize(eye))),2.);
            vec3 heat=mix(tint*vec3(2.8,.7,.25),vec3(4.,2.3,.6),density*density);
            gl_FragColor=vec4(heat,density*rim*.3*visibility);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      }));
      content.add(loop);
    }
  }
  content.traverse((object) => object.layers.set(1));

  let elapsed = 0, landed = reduceMotion, manualLook = false, descentAltitude = 1600, descentZ = 320, destinationZ = 0;
  if (reduceMotion) Object.assign(position, { z: 0, altitude: profile.arrival, pitch: -.04 });
  let flight = null, orbitReady = false, targetAltitude = position.altitude;
  const ground = (x, z) => terrainHeight(profile, x, z) - (radius.value ? (x * x + z * z) / (2 * radius.value) : 0);
  function readCamera() {
    position.x = camera.position.x;position.z = camera.position.z;
    position.altitude = Math.max(profile.minimum, camera.position.y - ground(position.x, position.z));
    const direction = camera.getWorldDirection(new THREE.Vector3());
    if (Math.hypot(direction.x, direction.z) > .001) position.yaw = Math.atan2(direction.x, -direction.z);
    position.pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    targetAltitude = position.altitude;
  }
  function startFlight(kind) {
    if (flight?.kind === kind) return;
    const fromAltitude = Math.max(profile.minimum, camera.position.y - ground(camera.position.x, camera.position.z));
    const destination = camera.clone();
    const altitude = kind === 'depart' ? orbitHeight(camera.aspect, fromAltitude) : profile.arrival;
    destination.position.y = ground(camera.position.x, camera.position.z) + altitude;
    destination.up.set(0, kind === 'depart' ? 0 : 1, kind === 'depart' ? -1 : 0);
    if (kind === 'depart') destination.lookAt(0, -SURFACE_RADIUS - SURFACE_CLEARANCE, 0);
    else destination.lookAt(destination.position.clone().add(new THREE.Vector3(Math.sin(position.yaw), -.04, -Math.cos(position.yaw))));
    flight = { kind, elapsed: 0, from: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, fromAltitude, altitude, destination };
    orbitReady = false;landed = true;
  }
  const keys = new Set(), held = new Set(), pointers = new Map(), listeners = [];
  const listen = (target, event, callback, options) => { target.addEventListener(event,callback,options);listeners.push(()=>target.removeEventListener(event,callback,options)); };
  const actions = { KeyW:'forward', ArrowUp:'forward', KeyS:'back', ArrowDown:'back', KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right', KeyE:'rise', KeyQ:'lower' };
  const interrupt = () => { if (flight) { readCamera();flight = null; }landed = true; manualLook = true; };
  const interact = (action) => {
    if (flight?.kind === 'depart' && action === 'lower') startFlight('land');
    else if (flight?.kind === 'land' && action === 'rise') startFlight('depart');
    else interrupt();
  };
  const changeAltitude = (factor) => {
    if (flight) {
      if (flight.kind === 'depart' && factor < 1) startFlight('land');
      else if (flight.kind === 'land' && factor > 1) startFlight('depart');
      return;
    }
    interrupt();targetAltitude = surfaceAltitude(profile, targetAltitude * factor);
    if (radius.value && targetAltitude > ASCENT_TRIGGER) startFlight('depart');
  };
  const clear = () => { keys.clear();held.clear();pointers.clear(); };
  listen(window,'keydown',(event)=>{
    if(blocked() || event.target.matches('input,select,textarea') || !actions[event.code])return;
    event.preventDefault();if(!keys.has(actions[event.code]))interact(actions[event.code]);keys.add(actions[event.code]);
  });
  listen(window,'keyup',(event)=>keys.delete(actions[event.code]));
  listen(window,'blur',clear);listen(document,'visibilitychange',clear);
  listen(input,'pointerdown',(event)=>{ if(blocked())return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});input.setPointerCapture(event.pointerId); });
  listen(input,'pointermove',(event)=>{
    const before=pointers.get(event.pointerId);if(!before)return;
    if(pointers.size===1){interrupt();position.yaw+=(event.clientX-before.x)*.004;position.pitch=THREE.MathUtils.clamp(position.pitch-(event.clientY-before.y)*.003,-1.55,1.55);manualLook=true;}
    else {const other=[...pointers.entries()].find(([id])=>id!==event.pointerId)?.[1];if(other){const old=Math.hypot(before.x-other.x,before.y-other.y),next=Math.hypot(event.clientX-other.x,event.clientY-other.y);if(old>5&&next>5)changeAltitude(old/next);}}
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])listen(input,event,(e)=>pointers.delete(e.pointerId));
  listen(input,'wheel',(event)=>{if(blocked())return;event.preventDefault();changeAltitude(Math.exp(Math.max(-.35,Math.min(.35,event.deltaY*.002))));},{passive:false});
  for (const button of buttons.querySelectorAll('[data-move]')) {
    const action=button.dataset.move;
    listen(button,'pointerdown',(event)=>{event.preventDefault();interact(action);held.add(action);button.setPointerCapture(event.pointerId);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])listen(button,event,()=>held.delete(action));
    listen(button,'click',(event)=>{if(event.detail===0){interrupt();moveOnSurface(position,profile,action==='forward'?1:action==='back'?-1:0,action==='right'?1:action==='left'?-1:0,action==='rise'?1:action==='lower'?-1:0,.25);}});
  }
  return { scene, camera, profile, position,
    connectSpace() { radius.value = SURFACE_RADIUS;camera.far = 3e8;camera.updateProjectionMatrix();startFlight('land'); },
    ascend() { clear();startFlight('depart'); },
    lower() { if(radius.value){clear();startFlight('land');}else if(reduceMotion){interrupt();position.altitude=targetAltitude=profile.arrival;}else{elapsed=0;landed=false;descentAltitude=position.altitude;descentZ=destinationZ=position.z;} },
    resize(aspect) { camera.aspect=aspect;camera.updateProjectionMatrix(); },
    step(dt, motion = dt) {
      elapsed += dt;time.value += motion;
      if (flight) {
        flight.elapsed += dt;
        const t = reduceMotion ? 1 : Math.min(1, flight.elapsed / 4.2), ease = t * t * (3 - 2 * t);
        const altitude = flightHeight(flight.fromAltitude, flight.altitude, t);
        camera.position.lerpVectors(flight.from, flight.destination.position, ease);
        camera.position.y = ground(camera.position.x, camera.position.z) + altitude;
        camera.quaternion.slerpQuaternions(flight.quaternion, flight.destination.quaternion, ease);
        camera.fov = THREE.MathUtils.lerp(flight.fov, flight.kind === 'depart' ? 49 : 67, ease);camera.updateProjectionMatrix();
        position.x = camera.position.x;position.z = camera.position.z;position.altitude = targetAltitude = altitude;
        if (t === 1) { orbitReady = flight.kind === 'depart';flight = null;position.pitch = -.04; }
      } else if (!landed) {
        const t=Math.min(1,elapsed/4.2),remaining=(1-t)**3;
        position.altitude=profile.arrival+(descentAltitude-profile.arrival)*remaining;position.z=destinationZ+(descentZ-destinationZ)*remaining;
        if(!manualLook)position.pitch=-.04-.46*remaining;
        targetAltitude = position.altitude;
        if(t===1)landed=true;
      }
      const pressed=(action)=>(keys.has(action)||held.has(action))&&!blocked()?1:0;
      const beforeX=position.x,beforeZ=position.z;
      const lift = pressed('rise') - pressed('lower');
      if (!flight && !orbitReady) {
        position.altitude = THREE.MathUtils.damp(position.altitude, targetAltitude, 10, dt);
        moveOnSurface(position,profile,pressed('forward')-pressed('back'),pressed('right')-pressed('left'),lift,dt);
        if (lift) targetAltitude = position.altitude;
        if (radius.value && position.altitude > ASCENT_TRIGGER && lift) startFlight(lift > 0 ? 'depart' : 'land');
      }
      const height=terrainHeight(profile,position.x,position.z)+position.altitude;
      if(obstacles.some((rock)=>height<rock.top+.8&&Math.hypot(position.x-rock.x,position.z-rock.z)<rock.radius+.6)){position.x=beforeX;position.z=beforeZ;}
      if(Math.hypot(position.x-centerX,position.z-centerZ)>360)updateTerrain();
      if (!flight && !orbitReady) {
        camera.position.set(position.x,ground(position.x,position.z)+position.altitude,position.z);camera.up.set(0,1,0);
        camera.lookAt(position.x+Math.sin(position.yaw)*Math.cos(position.pitch),camera.position.y+Math.sin(position.pitch),position.z-Math.cos(position.yaw)*Math.cos(position.pitch));
      }
      visibility.value = radius.value ? 1 - THREE.MathUtils.smoothstep(position.altitude, 1800, 10000) : 1;
      skyVisibility.value = radius.value ? 1 - THREE.MathUtils.smoothstep(position.altitude, 2500, 14000) : 1;
      for (const object of content.children) if (object.isMesh) object.visible = (object === sky ? skyVisibility.value : visibility.value) > .001;
      if (rocks) rocks.material.opacity = visibility.value;
      sky.position.copy(camera.position);
      return { altitude: position.altitude, arrived: landed && !flight, departing: flight?.kind === 'depart', orbitReady, grounded: profile.minimum<3&&position.altitude<3 };
    },
    dispose() { clear();listeners.forEach((remove)=>remove());content.traverse((object)=>{object.geometry?.dispose();object.material?.dispose();}); }
  };
}
