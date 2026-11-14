import * as THREE from 'three';

// 선형 HDR 장면에서 밝은 빛만 번지게 한 뒤, 화면 색 변환을 한 번 적용한다.
export function createOpticalRenderer(renderer) {
  const image = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
  const glow = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const scratch = glow.clone();
  const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const pass = (uniforms, fragmentShader, toneMapped = false) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, toneMapped, depthTest: false, depthWrite: false });
  const extract = pass({ image: { value: image.texture } }, `uniform sampler2D image;varying vec2 vUv;
    void main(){vec3 c=max(texture2D(image,vUv).rgb,vec3(0.));float l=dot(c,vec3(.2126,.7152,.0722));
      float contribution=smoothstep(2.6,4.,l)*max(l-2.6,0.)/max(l,.0001);gl_FragColor=vec4(c*contribution,1.);}`);
  const blur = pass({ image: { value: null }, step: { value: new THREE.Vector2() } }, `uniform sampler2D image;uniform vec2 step;varying vec2 vUv;
    void main(){vec3 c=texture2D(image,vUv).rgb*.227027;
      c+=(texture2D(image,vUv+step*1.384615).rgb+texture2D(image,vUv-step*1.384615).rgb)*.316216;
      c+=(texture2D(image,vUv+step*3.230769).rgb+texture2D(image,vUv-step*3.230769).rgb)*.070270;
      gl_FragColor=vec4(c,1.);}`);
  const output = pass({ image: { value: image.texture }, glow: { value: glow.texture } }, `uniform sampler2D image;uniform sampler2D glow;varying vec2 vUv;
    #include <common>
    #include <dithering_pars_fragment>
    void main(){gl_FragColor=vec4(max(texture2D(image,vUv).rgb+texture2D(glow,vUv).rgb*.22,vec3(0.)),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <dithering_fragment>
    }`, true);
  output.dithering = true;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), extract), scene = new THREE.Scene(), camera = new THREE.Camera();
  quad.frustumCulled = false; scene.add(quad);
  const size = new THREE.Vector2(), viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  function draw(material, target) {
    quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera);
  }
  return {
    render(world, eye) {
      renderer.getViewport(viewport); renderer.getScissor(scissor);
      const scissored = renderer.getScissorTest(), ratio = renderer.getPixelRatio();
      // 검수 페이지의 분할 화면도 같은 경로로 렌더링한다.
      size.set(Math.max(1, Math.round(viewport.z * ratio)), Math.max(1, Math.round(viewport.w * ratio)));
      if (image.width !== size.x || image.height !== size.y) {
        image.setSize(size.x, size.y); glow.setSize(Math.max(1, Math.round(size.x / 4)), Math.max(1, Math.round(size.y / 4))); scratch.setSize(glow.width, glow.height);
      }
      renderer.setScissorTest(false); renderer.setRenderTarget(image); renderer.render(world, eye);
      draw(extract, glow);
      blur.uniforms.image.value = glow.texture; blur.uniforms.step.value.set(1.6 / glow.width, 0); draw(blur, scratch);
      blur.uniforms.image.value = scratch.texture; blur.uniforms.step.value.set(0, 1.6 / glow.height); draw(blur, glow);
      quad.material = output; renderer.setRenderTarget(null); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissored); renderer.render(scene, camera);
    },
    dispose() {
      image.dispose(); glow.dispose(); scratch.dispose(); extract.dispose(); blur.dispose(); output.dispose(); quad.geometry.dispose();
    }
  };
}
