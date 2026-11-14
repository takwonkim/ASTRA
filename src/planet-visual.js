import * as THREE from 'three';

export const STARLIGHT_INTENSITY = 3.4;

function loadMap(file, anisotropy, color = false) {
  const texture = new THREE.TextureLoader().load(new URL(`../data/planets/${file}`, import.meta.url).href);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function atmosphere(radius, color, light, polarRatio, opacity) {
  const sunPosition = { value: new THREE.Vector3() };
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.026, 64, 40), new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, sunPosition, opacity: { value: opacity } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: 'varying vec3 n;varying vec3 p;void main(){n=normalize(mat3(modelMatrix)*normal);p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
    fragmentShader: `uniform vec3 tint;uniform vec3 sunPosition;uniform float opacity;varying vec3 n;varying vec3 p;
      void main(){vec3 normal=normalize(n);float rim=pow(1.-abs(dot(normal,normalize(cameraPosition-p))),3.5);
        float daylight=smoothstep(-.16,.38,dot(normal,normalize(sunPosition-p)));
        gl_FragColor=vec4(tint*1.4,rim*daylight*opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  shell.scale.y = polarRatio;
  shell.renderOrder = 2;
  shell.onBeforeRender = () => light.getWorldPosition(sunPosition.value);
  return shell;
}

export function createPlanetVisual({ planet, radius, surface, light, anisotropy }) {
  const root = new THREE.Group();
  const earth = planet.real && planet.id === 2;
  const saturn = planet.real && planet.id === 5;
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
  }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), material);
  mesh.scale.y = polarRatio;
  root.add(mesh);
  if (earth) {
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 64, 48), new THREE.MeshPhongMaterial({
      color: '#ffffff', alphaMap: loadMap('2k_earth_clouds.jpg', anisotropy),
      transparent: true, opacity: .88, depthWrite: false, shininess: 1, specular: '#000000'
    }));
    clouds.rotation.y = .07;
    clouds.renderOrder = 1;
    mesh.add(clouds);
  }
  if (['ocean', 'gas', 'ice'].includes(planet.kind)) root.add(atmosphere(radius, earth ? '#5a9de5' : planet.color, light, polarRatio, earth ? .55 : .16));
  if (planet.rings) {
    const inner = radius * 1.24, outer = radius * 2.28;
    const geometry = new THREE.RingGeometry(inner, outer, 192);
    const position = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) uv.setXY(i, (Math.hypot(position.getX(i), position.getY(i)) - inner) / (outer - inner), .5);
    const sunPosition = { value: new THREE.Vector3() };
    const ringMaterial = saturn ? new THREE.ShaderMaterial({
      uniforms: { map: { value: loadMap('2k_saturn_ring_alpha.png', anisotropy, true) }, sunPosition },
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
      vertexShader: 'varying vec2 vUv;varying vec3 p;varying vec3 n;void main(){vUv=uv;p=(modelMatrix*vec4(position,1.)).xyz;n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
      fragmentShader: `uniform sampler2D map;uniform vec3 sunPosition;varying vec2 vUv;varying vec3 p;varying vec3 n;
        void main(){vec4 texel=texture2D(map,vUv);if(texel.a<.02)discard;
          float scattered=.35+.65*sqrt(abs(dot(normalize(n),normalize(sunPosition-p))));
          gl_FragColor=vec4(texel.rgb*scattered*2.,texel.a*.96);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }) : new THREE.MeshPhongMaterial({ color: '#b9a488', transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, shininess: 1, specular: '#000000' });
    const ring = new THREE.Mesh(geometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    if (saturn) ring.onBeforeRender = () => light.getWorldPosition(sunPosition.value);
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
