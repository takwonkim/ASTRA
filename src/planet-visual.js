import * as THREE from 'three';

export const STARLIGHT_INTENSITY = 3.4;

function loadMap(file, anisotropy, color = false) {
  const texture = new THREE.TextureLoader().load(new URL(`../data/planets/${file}`, import.meta.url).href);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function atmosphere(radius, color, light, polarRatio, opacity) {
  const sunPosition = { value: new THREE.Vector3() }, eye = { value: new THREE.Vector3() };
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 64, 40), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, sunPosition, eye, opacity: { value: opacity } },
    transparent: true, depthWrite: false,
    vertexShader: `varying vec3 p;void main(){p=position/${radius.toFixed(6)};gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 tint;uniform vec3 sunPosition;uniform vec3 eye;uniform float opacity;varying vec3 p;
      void main(){float visible=1.-smoothstep(80.,150.,length(eye));if(visible<.001)discard;
        vec3 d=normalize(p-eye);float b=dot(eye,d),c=dot(eye,eye),outer=b*b-c+1.1025;
        if(outer<0.)discard;float start=max(0.,-b-sqrt(outer)),end=-b+sqrt(outer),ground=b*b-c+1.;
        if(ground>0.){float surface=-b-sqrt(ground);if(surface>0.)end=min(end,surface);}
        float step=(end-start)/8.,depth=0.,scattering=0.;
        for(int i=0;i<8;i++){vec3 q=eye+d*(start+(float(i)+.5)*step),sun=normalize(sunPosition-q);
          float r=length(q),density=exp(-max(0.,r-1.)/.009),along=dot(q,sun);
          float closest=sqrt(max(0.,dot(q,q)-along*along));float lit=along>0.?1.:smoothstep(.999,1.005,closest);
          float transmission=exp(-density*.035/max(.08,dot(q/r,sun)+.15));
          depth+=density*step;scattering+=density*step*lit*transmission;}
        vec3 sun=normalize(sunPosition-p);float mu=dot(sun,-d),phase=.75*(1.+mu*mu)+.25*pow(max(mu,0.),12.);
        float alpha=(1.-exp(-depth*24.*opacity))*visible;float lit=scattering/max(depth,1.e-6);
        gl_FragColor=vec4(tint*phase*lit*1.6,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  shell.scale.y = polarRatio;
  shell.renderOrder = 2;
  shell.onBeforeRender = (_renderer, _scene, camera) => {
    shell.worldToLocal(light.getWorldPosition(sunPosition.value));
    shell.worldToLocal(camera.getWorldPosition(eye.value));
    sunPosition.value.divideScalar(radius); eye.value.divideScalar(radius);
  };
  return shell;
}

export function createPlanetVisual({ planet, radius, surface, light, anisotropy }) {
  const root = new THREE.Group();
  const earth = planet.real && planet.id === 2;
  const saturn = planet.real && planet.id === 5;
  const cloudMap = earth ? loadMap('2k_earth_clouds.jpg', anisotropy) : null;
  const ringMap = saturn ? loadMap('2k_saturn_ring_alpha.png', anisotropy, true) : null;
  const localSun = { value: new THREE.Vector3() };
  const polarRatio = planet.real ? [1, 1, .9966, .9941, .9351, .902, .977, .983][planet.id] : 1;
  const material = new THREE.MeshPhongMaterial({
    map: surface, color: '#ffffff', shininess: earth ? 45 : 3,
    specular: earth ? '#5a6672' : '#08090b',
    emissive: planet.kind === 'lava' ? '#62190b' : '#000000', emissiveIntensity: .5
  });
  if (earth) {
    material.normalMap = loadMap('2k_earth_normal_map.png', anisotropy);
    material.normalScale.set(.4, .4);
    material.specularMap = loadMap('2k_earth_specular_map.png', anisotropy);
    material.emissiveMap = loadMap('2k_earth_nightmap.jpg', anisotropy, true);
    material.emissive.set('#fff1d9'); material.emissiveIntensity = 1.4;
  } else if (!planet.real && ['rock', 'desert', 'ice', 'lava'].includes(planet.kind)) {
    material.bumpMap = surface; material.bumpScale = radius * .018;
  }
  if (earth || saturn) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.localSun = localSun;
      shader.uniforms.shadowMap = { value: earth ? cloudMap : ringMap };
      shader.vertexShader = 'varying vec3 surfacePosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nsurfacePosition=position/${radius.toFixed(6)};`);
      shader.fragmentShader = 'varying vec3 surfacePosition;uniform vec3 localSun;uniform sampler2D shadowMap;\n' + shader.fragmentShader;
      const shading = earth ? `
        vec3 n=normalize(surfacePosition),sun=normalize(localSun-surfacePosition);float day=dot(n,sun);
        float travel=-day+sqrt(day*day+.024144);vec3 cloud=normalize(n+sun*travel);
        vec2 cloudUv=vec2(fract(atan(cloud.z,-cloud.x)/6.2831853-.07/6.2831853),asin(cloud.y)/3.14159265+.5);
        float cover=texture2D(shadowMap,cloudUv).g,shadow=1.-cover*.52;
        reflectedLight.directDiffuse*=shadow;reflectedLight.directSpecular*=shadow;
        totalEmissiveRadiance*=(1.-smoothstep(-.16,.08,day))*(1.-cover*.8);` : `
        vec3 sun=normalize(localSun-surfacePosition);float shadow=1.;
        if(abs(sun.y)>.0001){float t=-surfacePosition.y/sun.y;vec3 hit=surfacePosition+sun*t;
          float u=(length(hit.xz)-1.24)/1.04,spread=max(fwidth(u),.001);
          float cover=(texture2D(shadowMap,vec2(u-spread,.5)).a+texture2D(shadowMap,vec2(u,.5)).a*2.+texture2D(shadowMap,vec2(u+spread,.5)).a)*.25;
          if(t>0.&&u>0.&&u<1.)shadow=1.-cover*.88;}
        reflectedLight.directDiffuse*=shadow;reflectedLight.directSpecular*=shadow;`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + shading);
    };
    material.customProgramCacheKey = () => `astra-planet-shadows-${earth ? 'earth' : 'saturn'}-${radius}`;
  }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), material);
  mesh.scale.y = polarRatio;
  if (earth || saturn) mesh.onBeforeRender = () => mesh.worldToLocal(light.getWorldPosition(localSun.value)).divideScalar(radius);
  root.add(mesh);
  if (earth) {
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 64, 48), new THREE.MeshPhongMaterial({
      color: '#ffffff', alphaMap: cloudMap,
      transparent: true, opacity: .95, depthWrite: false, shininess: 1, specular: '#000000'
    }));
    clouds.rotation.y = .07;
    clouds.renderOrder = 1;
    mesh.add(clouds);
  }
  if (['ocean', 'gas', 'ice'].includes(planet.kind)) root.add(atmosphere(radius, earth ? '#5a9de5' : planet.color, light, polarRatio, earth ? .16 : .025));
  if (planet.rings) {
    const inner = radius * 1.24, outer = radius * 2.28;
    const geometry = new THREE.RingGeometry(inner, outer, 192);
    const position = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) uv.setXY(i, (Math.hypot(position.getX(i), position.getY(i)) - inner) / (outer - inner), .5);
    const sunPosition = { value: new THREE.Vector3() };
    const ringMaterial = saturn ? new THREE.ShaderMaterial({
      uniforms: { map: { value: ringMap }, sunPosition, localSun },
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
      vertexShader: `varying vec2 vUv;varying vec3 p;varying vec3 n;varying vec3 ringPosition;void main(){vUv=uv;ringPosition=vec3(position.x,0.,-position.y)/${radius.toFixed(6)};p=(modelMatrix*vec4(position,1.)).xyz;n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
      fragmentShader: `uniform sampler2D map;uniform vec3 sunPosition;uniform vec3 localSun;varying vec2 vUv;varying vec3 p;varying vec3 n;varying vec3 ringPosition;
        void main(){vec4 texel=texture2D(map,vUv);if(texel.a<.02)discard;
          vec3 q=ringPosition/vec3(1.,${polarRatio.toFixed(4)},1.),l=normalize(localSun-ringPosition)/vec3(1.,${polarRatio.toFixed(4)},1.);
          float along=dot(q,l),closest=sqrt(max(0.,dot(q,q)-along*along/dot(l,l)));
          float shadow=along<0.?smoothstep(.98,1.025,closest):1.;
          float scattered=.35+.65*sqrt(abs(dot(normalize(n),normalize(sunPosition-p))));
          gl_FragColor=vec4(texel.rgb*scattered*2.*mix(.045,1.,shadow),texel.a*.96);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }) : new THREE.MeshPhongMaterial({ color: '#b9a488', transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, shininess: 1, specular: '#000000' });
    const ring = new THREE.Mesh(geometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    if (saturn) ring.onBeforeRender = () => {
      light.getWorldPosition(sunPosition.value);
      root.worldToLocal(light.getWorldPosition(localSun.value)).divideScalar(radius);
    };
    root.add(ring);
    if (!saturn) for (let band = 0; band < 4; band++) {
      const gap = new THREE.Mesh(new THREE.RingGeometry(radius * (1.5 + band * .17), radius * (1.54 + band * .17), 80), new THREE.MeshBasicMaterial({ color: '#1b2027', transparent: true, opacity: .65, side: THREE.DoubleSide }));
      gap.rotation.copy(ring.rotation);
      root.add(gap);
    }
  }
  if (earth || saturn) root.rotation.z = THREE.MathUtils.degToRad(earth ? 23.4 : 26.7);
  return { root, mesh };
}
