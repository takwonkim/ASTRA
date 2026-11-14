import * as THREE from 'three';

const noise = `
  float hash3(vec3 p){p=fract(p*.3183099+vec3(.17,.31,.73));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float fbm(vec3 p){return noise3(p)*.55+noise3(p*2.03)*.27+noise3(p*4.07)*.12+noise3(p*8.1)*.06;}
  float granule(vec3 p){vec3 cell=floor(p),q=fract(p);float nearest=2.;
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
      vec3 offset=vec3(float(x),float(y),float(z));vec3 seed=cell+offset;
      vec3 jitter=vec3(hash3(seed),hash3(seed+19.),hash3(seed+43.));
      nearest=min(nearest,length(offset+jitter-q));}
    return 1.-smoothstep(.12,.75,nearest);}
`;

export function createStarVisual(star, glow) {
  const root = new THREE.Group();
  const size = THREE.MathUtils.clamp(star.mass ** .3, .65, 1.7);
  root.scale.setScalar(size);
  root.userData.radius = 3.5 * size;
  const time = { value: 0 };
  const isSun = star.real && star.seed === 'sol';
  const haloColor = isSun ? '#ffbf75' : star.color;
  const uniforms = { tint: { value: new THREE.Color(star.color) }, time, spotStrength: { value: ['M', 'K', 'G'].includes(star.type) ? 1 : .25 }, solarMap: { value: null }, solarAppearance: { value: 0 } };
  if (isSun) {
    uniforms.solarMap.value = new THREE.TextureLoader().load(new URL('../data/planets/2k_sun.jpg', import.meta.url).href, () => { uniforms.solarAppearance.value = 1; });
    uniforms.solarMap.value.colorSpace = THREE.SRGBColorSpace;
  }
  const surface = new THREE.Mesh(new THREE.SphereGeometry(3.5, 64, 48), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 p;varying vec3 n;varying vec3 eye;varying vec2 surfaceUv;void main(){surfaceUv=uv;p=position/3.5;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);eye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `${noise}
      uniform vec3 tint;uniform float time;uniform float spotStrength;uniform sampler2D solarMap;uniform float solarAppearance;varying vec3 p;varying vec3 n;varying vec3 eye;varying vec2 surfaceUv;
      void main(){vec3 flow=normalize(p)*120.+vec3(time*.18,0.,time*.12);
        float detail=1.-smoothstep(.65,2.1,length(fwidth(p))*120.);
        float cells=detail>.01?granule(flow):.5;float fine=noise3(flow*2.8);float lanes=smoothstep(.15,.85,cells);
        float field=fbm(p*8.+vec3(0.,time*.015,0.));float belt=1.-smoothstep(.32,.65,abs(p.y));
        float penumbra=smoothstep(.65,.74,field)*belt;float umbra=smoothstep(.74,.79,field)*belt;
        float limb=.34+.66*pow(max(dot(normalize(n),normalize(eye)),0.),.42);
        float grain=mix(1.7,1.1+lanes*1.25+fine*.12,detail);
        vec3 hot=mix(tint,vec3(1.),.38);vec3 color=hot*grain*(1.-(penumbra*.55+umbra*.27)*spotStrength)*limb;
        if(solarAppearance>.5){vec3 mapped=texture2D(solarMap,surfaceUv).rgb;
          color=mix(mapped,mapped*1.15+vec3(.04,.025,.008),.5)*2.9*mix(1.,.7+.5*lanes,detail)*limb;}
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  root.add(surface);
  const corona = new THREE.Mesh(new THREE.SphereGeometry(6.1, 48, 32), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(haloColor) }, time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: 'varying vec3 n;varying vec3 eye;varying vec3 p;void main(){p=position;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);eye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader: `${noise} uniform vec3 tint;uniform float time;varying vec3 n;varying vec3 eye;varying vec3 p;
      void main(){float mu=abs(dot(normalize(n),normalize(eye)));float r=sqrt(max(0.,1.-mu*mu))*6.1/3.5;
        vec3 direction=normalize(p);float plumes=pow(fbm(direction*18.+vec3(time*.025,0.,0.)),2.);
        float edge=smoothstep(.97,1.025,r)*exp(-max(0.,r-1.)*14.)*(1.-smoothstep(1.3,1.5,r));
        if(edge<.05)discard;
        gl_FragColor=vec4(mix(tint,vec3(1.),.4)*2.2,edge*(.02+plumes*.35)*.35);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  root.add(corona);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: haloColor, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.scale.set(34, 34, 1);
  root.add(halo);
  const outer = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: haloColor, transparent: true, opacity: .055, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  outer.scale.set(80, 80, 1);
  root.add(outer);
  for (const layer of [halo, outer]) {
    layer.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        float radius=length(vMapUv*2.-1.);
        diffuseColor.a*=exp(-10.*radius*radius)*(1.-smoothstep(.75,1.,radius));`);
    };
    layer.material.customProgramCacheKey = () => 'astra-smooth-halo';
  }
  for (let i = 0; i < 7; i++) {
    const points = Array.from({ length: 25 }, (_, j) => {
      const t = j / 24 * Math.PI;
      const height = .3 + (i % 3) * .21;
      return new THREE.Vector3(Math.cos(t) * (.25 + (i % 4) * .09), 3.43 + Math.sin(t) * height, Math.sin(t * 3 + i) * .04);
    });
    const loop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, .008, 5, false), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff853a').lerp(new THREE.Color(star.color), .4).multiplyScalar(2), transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }));
    loop.rotation.set(i * 2.1, i * 1.7, i * 2.4);
    root.add(loop);
  }
  root.userData.surface = surface;
  root.userData.time = time;
  return root;
}

export { createBlackHoleVisual, createBlackHoleBackground } from './black-hole-visual.js?v=8';

export function updateObjectVisual(root, days) {
  root.userData.time.value = (days % 1000) * 0.04;
}
