import * as THREE from 'three';
import { BLACK_HOLE as BH } from './black-hole-math.js?v=6';

// 기존 배경 별과 같은 방향·색을 사용한다. 다른 장면 물체의 렌즈 효과는 포함하지 않는다.
export function createBlackHoleBackground(positions, colors) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1024;
  const ctx = canvas.getContext('2d'), color = new THREE.Color();
  ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < positions.length; i += 3) {
    const direction = new THREE.Vector3(...positions.slice(i, i + 3)).normalize();
    const x = (Math.atan2(direction.z, direction.x) / (2 * Math.PI) + .5) * canvas.width;
    const y = (.5 - Math.asin(direction.y) / Math.PI) * canvas.height;
    color.fromArray(colors, i);
    ctx.fillStyle = color.getStyle();
    ctx.beginPath(); ctx.arc(x, y, .7, 0, 2 * Math.PI); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export function createBlackHoleVisual(backgroundMap = null) {
  const root = new THREE.Group(), time = { value: 0 };
  // 선택용 구체만 남기고 보이는 그림자는 광선 포획으로 계산한다.
  const surface = new THREE.Mesh(new THREE.SphereGeometry(BH.criticalImpact * BH.scale, 32, 24), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  const uniforms = { time, eye: { value: new THREE.Vector3() }, worldRotation: { value: new THREE.Matrix3() }, backgroundMap: { value: backgroundMap }, hasBackground: { value: backgroundMap ? 1 : 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 localPosition;void main(){localPosition=position/${BH.scale.toFixed(2)};gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      uniform vec3 eye;uniform float time;uniform mat3 worldRotation;uniform sampler2D backgroundMap;uniform float hasBackground;varying vec3 localPosition;
      float hash3(vec3 p){p=fract(p*.3183099+vec3(.17,.31,.73));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
      float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
      vec3 gradient(vec3 p){float r=length(p);return -.25*(3./(r+.25)+1./(r-.25))*p/(r*r);}
      vec3 bending(vec3 p,vec3 d){vec3 g=gradient(p);return g-d*dot(d,g);}
      float areal(float r){return r*pow(1.+.25/r,2.);}
      vec3 emission(vec3 p,vec3 d){
        float r=areal(length(p)),a=atan(p.z,p.x),beta=sqrt(1./(2.*(r-1.)));
        vec3 tangent=normalize(vec3(-p.z,0.,p.x));
        float shift=sqrt(1.-1./r)*sqrt(1.-beta*beta)/(1.+beta*dot(tangent,d));
        float phase=a-time*70./pow(r,1.5)+log(r)*.8;
        vec3 flow=vec3(cos(phase)*r,sin(phase)*r,r*.6);
        float warp=noise3(flow*.35)*.8;
        float broad=noise3(flow*.8+warp),fine=noise3(flow*3.2+broad);
        float turbulence=.4+1.5*smoothstep(.15,.9,broad*.8+fine*.2);
        float threads=.9+.1*sin(r*9.+warp*4.+noise3(flow*.9)*12.);
        float flux=pow(${BH.inner.toFixed(1)}/r,3.)*(1.-sqrt(${BH.inner.toFixed(1)}/r))/.057;
        flux+=.11*pow(6./r,2.)*smoothstep(5.,8.,r);
        float heat=pow(max(flux,0.),.25)*shift;
        vec3 color=mix(vec3(.48,.055,.009),vec3(1.,.46,.16),smoothstep(.2,.8,heat));
        color=mix(color,vec3(1.,.91,.78),smoothstep(.72,1.3,heat));
        float intensity=3.8*flux*pow(shift,3.)*turbulence*threads;
        intensity*=.6+.4*sqrt(abs(d.y));
        return color*intensity;
      }
      void main(){
        vec3 p=eye,d=normalize(localPosition-eye),initial=d,color=vec3(0.);float alpha=1.;bool hit=false;
        bool entered=length(p)<${BH.escape.toFixed(1)};
        for(int i=0;i<${BH.steps};i++){
          float r=length(p);
          if(r<${BH.capture.toFixed(3)}){hit=true;break;}
          if(r<${BH.escape.toFixed(1)})entered=true;
          if(entered&&r>${BH.escape.toFixed(1)}&&dot(p,d)>0.)break;
          float h=r>8.?.1*r:.07*(r-.25);
          vec3 pm=p+d*(h*.5),dm=normalize(d+bending(p,d)*(h*.5));
          vec3 pn=p+dm*h,dn=normalize(d+bending(pm,dm)*h);
          if(p.y*pn.y<=0.&&abs(pn.y-p.y)>1.e-8){
            float t=-p.y/(pn.y-p.y);vec3 q=mix(p,pn,t);float diskRadius=areal(length(q));
            if(diskRadius>=${BH.inner.toFixed(1)}&&diskRadius<=${BH.outer.toFixed(1)}){color=emission(q,normalize(mix(d,dn,t)));alpha=1.-smoothstep(12.,${BH.outer.toFixed(1)},diskRadius);hit=true;break;}
          }
          p=pn;d=dn;
        }
        if(!hit){
          if(length(p)<${BH.escape.toFixed(1)}){color=vec3(0.);}else{
            float r=length(eye),n=pow(1.+.25/r,3.)/(1.-.25/r);
            float impact=n*length(cross(eye,initial));alpha=1.-smoothstep(5.,12.,impact);
            if(alpha<.001||hasBackground<.5)discard;
            vec3 sky=normalize(worldRotation*d);
            vec2 uv=vec2(atan(sky.z,sky.x)/6.2831853+.5,asin(clamp(sky.y,-1.,1.))/3.14159265+.5);
            color=texture2D(backgroundMap,uv).rgb;
          }
        }
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const lens = new THREE.Mesh(new THREE.SphereGeometry(22 * BH.scale, 40, 24), material);
  const rotation = new THREE.Matrix4(), cameraPosition = new THREE.Vector3();
  lens.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(cameraPosition);
    uniforms.eye.value.copy(root.worldToLocal(cameraPosition)).divideScalar(BH.scale);
    rotation.extractRotation(root.matrixWorld);
    uniforms.worldRotation.value.setFromMatrix4(rotation);
  };
  root.add(surface, lens);
  root.userData.surface = surface;
  root.userData.time = time;
  return root;
}
