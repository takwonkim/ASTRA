const DEG = Math.PI / 180;
const mod = (n, d) => ((n % d) + d) % d;
export const SKY_RATES = [1, 10, 60, 300, 900, 3600, 21600];
export const OBSERVERS = [
  { id: 'seoul', name: '서울', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' },
  { id: 'busan', name: '부산', latitude: 35.1796, longitude: 129.0756, timezone: 'Asia/Seoul' },
  { id: 'jeju', name: '제주', latitude: 33.4996, longitude: 126.5312, timezone: 'Asia/Seoul' },
  { id: 'tokyo', name: '도쿄', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { id: 'london', name: '런던', latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' },
  { id: 'new-york', name: '뉴욕', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
  { id: 'sydney', name: '시드니', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' },
  { id: 'custom', name: '직접 지정', latitude: 37.5665, longitude: 126.978, timezone: 'UTC' }
];

export function julianDate(date) { return Number(date) / 86400000 + 2440587.5; }

// USNO의 근사 평균항성시. UTC를 UT1의 근사로 사용한다.
export function siderealDegrees(date, longitude = 0) {
  const jd = julianDate(date);
  const midnight = Math.floor(jd - 0.5) + 0.5;
  const d = midnight - 2451545;
  const hours = (jd - midnight) * 24;
  const t = (jd - 2451545) / 36525;
  return mod((6.697375 + .065709824279 * d + 1.0027379 * hours + .0000258 * t * t) * 15 + longitude, 360);
}

export function equatorialVector(ra, dec) {
  const r = ra * DEG, d = dec * DEG;
  return [Math.cos(d) * Math.cos(r), Math.sin(d), -Math.cos(d) * Math.sin(r)];
}

// J2000의 평균좌표를 관측 연도의 평균좌표로 세차시킨다.
export function precessJ2000(ra, dec, date) {
  const t = (julianDate(date) - 2451545) / 36525;
  const zeta = (2306.2181 * t + .30188 * t * t + .017998 * t ** 3) / 3600 * DEG;
  const z = (2306.2181 * t + 1.09468 * t * t + .018203 * t ** 3) / 3600 * DEG;
  const theta = (2004.3109 * t - .42665 * t * t - .041833 * t ** 3) / 3600 * DEG;
  const r = ra * DEG, d = dec * DEG;
  const a = Math.cos(d) * Math.sin(r + zeta);
  const b = Math.cos(theta) * Math.cos(d) * Math.cos(r + zeta) - Math.sin(theta) * Math.sin(d);
  const c = Math.sin(theta) * Math.cos(d) * Math.cos(r + zeta) + Math.cos(theta) * Math.sin(d);
  return [mod((Math.atan2(a, b) + z) / DEG, 360), Math.asin(Math.max(-1, Math.min(1, c))) / DEG];
}

export function horizontalVector(ra, dec, date, observer, precess = true) {
  if (precess) [ra, dec] = precessJ2000(ra, dec, date);
  const h = (siderealDegrees(date, observer.longitude) - ra) * DEG;
  const d = dec * DEG, p = observer.latitude * DEG;
  return [-Math.cos(d) * Math.sin(h), Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(h) * Math.cos(p),
    Math.cos(d) * Math.cos(h) * Math.sin(p) - Math.sin(d) * Math.cos(p)];
}

export function altitudeAzimuth(ra, dec, date, observer) {
  const [east, up, south] = horizontalVector(ra, dec, date, observer);
  return { altitude: Math.asin(Math.max(-1, Math.min(1, up))) / DEG, azimuth: mod(Math.atan2(east, -south) / DEG, 360) };
}

export function localDateInput(date, timezone) {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

export function dateFromLocal(value, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const desired = Date.parse(value + ':00Z');
  if (!Number.isFinite(desired)) return null;
  let candidate = desired;
  for (let i = 0; i < 3; i++) candidate += desired - Date.parse(localDateInput(new Date(candidate), timezone) + ':00Z');
  const result = new Date(candidate);
  return localDateInput(result, timezone) === value ? result : null;
}

export function tonight(observer, now = new Date()) {
  return dateFromLocal(localDateInput(now, observer.timezone).slice(0, 10) + 'T21:00', observer.timezone);
}
