import * as THREE from 'three';

const noise = `
  float hash3(vec3 p){p=fract(p*.3183099+vec3(.17,.31,.73));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float fbm(vec3 p){return noise3(p)*.55+noise3(p*2.03)*.27+noise3(p*4.07)*.12+noise3(p*8.1)*.06;}
`;

export function createStarVisual(star, glow) {
  const root = new THREE.Group();
  const size = THREE.MathUtils.clamp(star.mass ** .3, .65, 1.7);
  root.scale.setScalar(size);
  root.userData.radius = 3.5 * size;
  const time = { value: 0 };
  const surface = new THREE.Mesh(new THREE.SphereGeometry(3.5, 64, 48), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(star.color) }, time },
    vertexShader: `varying vec3 p;varying vec3 n;varying vec3 eye;void main(){p=position/3.5;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);eye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `${noise}
      uniform vec3 tint;uniform float time;varying vec3 p;varying vec3 n;varying vec3 eye;
      void main(){vec3 flow=p*24.+vec3(time*.12,0.,time*.08);float granules=noise3(flow);float cells=fbm(flow*1.7);
        float spots=smoothstep(.68,.8,fbm(p*7.+vec3(0.,time*.025,0.)));
        float limb=.4+.6*pow(max(dot(normalize(n),normalize(eye)),0.),.38);
        vec3 color=tint*(.72+granules*.48+cells*.35)*(1.-spots*.82)*limb;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  root.add(surface);
  const corona = new THREE.Mesh(new THREE.SphereGeometry(3.68, 48, 32), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(star.color) }, time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: 'varying vec3 n;varying vec3 eye;varying vec3 p;void main(){p=position;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);eye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: `${noise} uniform vec3 tint;uniform float time;varying vec3 n;varying vec3 eye;varying vec3 p;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),3.);float plasma=.25+fbm(p*3.+time*.02);gl_FragColor=vec4(tint*1.5,rim*plasma*.3);}`
  }));
  root.add(corona);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: star.color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(23, 23, 1);
  root.add(halo);
  for (let i = 0; i < 2; i++) {
    const points = Array.from({ length: 25 }, (_, j) => {
      const t = j / 24 * Math.PI;
      return new THREE.Vector3(Math.cos(t) * 0.68, 3.39 + Math.sin(t) * 0.8, 0);
    });
    const loop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.018, 5, false), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6b24').lerp(new THREE.Color(star.color), .25), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    loop.rotation.set(i * 2.1, i * 1.7, i * 2.4);
    root.add(loop);
  }
  root.userData.surface = surface;
  root.userData.time = time;
  return root;
}

export function createBlackHoleVisual() {
  const root = new THREE.Group();
  const time = { value: 0 };
  const shadow = new THREE.Mesh(new THREE.SphereGeometry(3.45, 64, 48), new THREE.MeshBasicMaterial({ color: '#000000' }));
  root.add(shadow);
  const disk = new THREE.Mesh(new THREE.RingGeometry(4.8, 19, 160, 16), new THREE.ShaderMaterial({
    uniforms: { time }, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 p;varying vec3 eye;void main(){p=position;eye=cameraPosition;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `${noise}
      uniform float time;varying vec3 p;varying vec3 eye;
      void main(){float r=length(p.xy);float a=atan(p.y,p.x);float spin=time*4./pow(r*.18,1.5);
        vec3 turbulence=vec3(cos(a-spin)*r*.7,sin(a-spin)*r*.7,r*1.4);
        float filaments=(.65+.35*fbm(turbulence*3.))*(.85+.15*sin(r*10.+fbm(turbulence)*18.));
        float edge=smoothstep(4.8,5.8,r)*(1.-smoothstep(12.,19.,r));
        float heat=pow(5./r,.85);float beam=.68+.55*cos(a-.4);
        vec3 color=mix(vec3(.75,.12,.015),vec3(1.,.62,.22),heat);
        color=mix(color,vec3(1.,.9,.67),smoothstep(.72,1.,heat));
        float intensity=filaments*beam*(.7+fbm(turbulence*2.))*pow(heat,1.4);
        gl_FragColor=vec4(color*intensity*3.2,edge*.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  disk.rotation.x = -Math.PI / 2;
  root.add(disk);
  const lens = new THREE.Group();
  const arcMaterial = () => new THREE.ShaderMaterial({
    uniforms: { time, strength: { value: .7 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 p;varying vec3 n;varying vec3 eye;varying vec2 vUv;void main(){p=position;n=normalize(normalMatrix*normal);vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);eye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: `${noise} uniform float time;uniform float strength;varying vec3 p;varying vec3 n;varying vec3 eye;varying vec2 vUv;void main(){float edge=pow(abs(dot(normalize(n),normalize(eye))),1.8);float ends=smoothstep(0.,.08,vUv.x)*(1.-smoothstep(.92,1.,vUv.x));float cloud=.65+.35*fbm(p*3.+time*.1);gl_FragColor=vec4(vec3(1.,.65,.28)*cloud*1.5,edge*ends*strength);}`
  });
  const photon = new THREE.Mesh(new THREE.TorusGeometry(3.73, 0.05, 8, 160), new THREE.MeshBasicMaterial({ color: '#ffe0a4', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.55, 16, 128, Math.PI), arcMaterial());
  arch.scale.y = 0.9;
  const lower = new THREE.Mesh(new THREE.TorusGeometry(4.15, 0.17, 12, 128, Math.PI), arcMaterial());
  lower.rotation.z = Math.PI;
  lower.scale.y = 0.8;
  lens.add(photon, arch, lower);
  root.add(lens);
  root.userData.surface = shadow;
  root.userData.time = time;
  root.userData.lens = lens;
  root.userData.arcs = [arch, lower];
  return root;
}

export function updateObjectVisual(root, days, camera) {
  root.userData.time.value = (days % 1000) * 0.04;
  if (root.userData.lens) {
    const rotation = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    root.userData.lens.quaternion.copy(rotation.multiply(camera.quaternion));
    const direction = camera.position.clone().sub(root.getWorldPosition(new THREE.Vector3())).normalize();
    direction.applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert());
    for (const arc of root.userData.arcs) arc.material.uniforms.strength.value = .7 * (1 - direction.y ** 2);
  }
}
