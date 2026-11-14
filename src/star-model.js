// 주계열성의 대표 구조. 태양 이외의 경계 비율은 설명용이다.
export function stellarProfile(star) {
  const sun = star.real && star.seed === 'sol';
  const core = (radius, convective) => ({ id: 'core', name: '핵융합 중심', radius, color: '#fff0b0', transport: convective ? '대류' : '복사', description: '중심의 높은 온도와 압력에서 수소 핵융합이 에너지를 만듭니다. 밝은 색은 내부를 구분하기 위한 표현입니다.' });
  const radiation = (radius) => ({ id: 'radiative', name: '복사층', radius, color: '#f7b337', transport: '복사', description: '빛이 물질에 흡수되고 다시 방출되며 에너지가 바깥으로 전달됩니다. 화면의 흐름은 이 과정을 설명하는 표현입니다.' });
  const convection = (radius) => ({ id: 'convective', name: '대류층', radius, color: '#e15c24', transport: '대류', description: '뜨거운 플라스마가 올라가고 식은 플라스마가 내려오면서 에너지를 옮깁니다. 움직이는 무늬는 대류를 나타내는 모형입니다.' });
  const photosphere = { id: 'photosphere', name: '광구', radius: 1, color: star.color, transport: '빛의 방출', description: '별빛이 우주로 빠져나와 우리가 표면처럼 보는 얇은 영역입니다. 단면에서는 식별할 수 있도록 두께를 크게 늘렸습니다.' };
  let family, layers;
  if (star.mass < .35) {
    family = '전체 대류형';
    layers = [core(.22, true), convection(.985)];
    layers[0].description += ' 이 별은 중심부터 바깥까지 대류하며, 여기 표시한 중심 영역은 별도의 복사층 경계가 아닙니다.';
    layers[1].description += ' 작은 적색왜성은 중심까지 대류가 이어집니다.';
  } else if (star.mass < 1.2) {
    family = '태양형';
    layers = [core(.25, false), radiation(.70), convection(.985)];
  } else if (star.mass < 1.5) {
    family = '대류핵 · 얕은 대류 외피';
    layers = [core(.20, true), radiation(.91), convection(.985)];
  } else {
    family = '대류핵 · 복사 외피';
    layers = [core(.32, true), radiation(.985)];
  }
  layers.push(photosphere);
  return { family, sun, layers, note: sun ? '태양의 대표 구조 · 광구 두께 강조' : '질량 구간별 대표 구조 · 경계 비율은 설명용' };
}

export function layerAtRadius(profile, radius) {
  return profile.layers.find((layer) => radius <= layer.radius) || profile.layers.at(-1);
}

export function insideStellarCut(x, z, angle, opening) {
  const forward = x * Math.cos(angle) + z * Math.sin(angle);
  const sideways = -x * Math.sin(angle) + z * Math.cos(angle);
  return opening > .001 && forward > 0 && Math.abs(sideways) < forward * Math.tan(opening * Math.PI / 3);
}

export function stellarZoomBoundary(active, distanceInRadii, direction, aspect = 1) {
  if (!active && direction > 0 && distanceInRadii < 3.1) return 'inside';
  if (active && direction < 0 && distanceInRadii > 5.5 * Math.max(1, 1 / aspect)) return 'outside';
  return null;
}
