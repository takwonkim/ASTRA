export const SOLAR_MAPS = [
  { file: '2k_mercury.jpg', layer: '표면 지도' },
  { file: '2k_venus_atmosphere.jpg', layer: '구름 지도' },
  { file: '2k_earth_daymap.jpg', layer: '주간 지표 지도' },
  { file: '2k_mars.jpg', layer: '표면 지도' },
  { file: '2k_jupiter.jpg', layer: '대기 지도' },
  { file: '2k_saturn.jpg', layer: '대기 지도' },
  { file: '2k_uranus.jpg', layer: '대기 지도' },
  { file: '2k_neptune.jpg', layer: '대기 지도' }
];

export function solarMapFor(planet) {
  return planet.real && planet.seed === `sol/${planet.id}` ? SOLAR_MAPS[planet.id] : null;
}
