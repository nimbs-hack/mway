// GLSL for the helmet view. The ground is GENERATED: noise, not terrain data.
// Nothing here reads an elevation model or an image, and no slope or rock in
// this view says anything about the real site. The page says so on screen.
//
// Axes: x east, y up, z north, in meters. The astronaut stands at the origin.
// The ground is a height field, drawn by marching a ray per pixel until it
// meets the ground. Detail drops with distance (the `t` argument), so far
// ground costs less and does not shimmer.
//
// Three things move: dust streaks over the ground, a dust devil in the
// middle distance, and grains drifting past the visor. All are generated too.

const TERRAIN = /* glsl */ `
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
// A layered mountain 7 km away at bearing 150 degrees.
const vec2 MOUNT = vec2(3500.0, -6060.0);

uint hashu(uvec2 x) {
  uvec2 q = 1103515245u * ((x >> 1u) ^ x.yx);
  return 1103515245u * (q.x ^ (q.y >> 3u));
}
float hashf(ivec2 p) { return float(hashu(uvec2(p))) * (1.0 / 4294967295.0); }
// Next number of a sequence, 0 to 1.
float rnd(inout uint s) {
  s = s * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return float((w >> 22u) ^ w) * (1.0 / 4294967295.0);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  return mix(mix(hashf(c), hashf(c + ivec2(1, 0)), u.x), mix(hashf(c + ivec2(0, 1)), hashf(c + ivec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < octaves; i++) {
    sum += amp * noise(p);
    p = ROT * p * 2.03;
    amp *= 0.5;
  }
  return sum;
}
// Turns a smooth rise into benches and scarps, like layered rock.
float bench(float h, float spacing) {
  float k = 6.2832 / spacing;
  return h + 0.7 * sin(k * h) / k;
}

// Ground at the scale of hills: swells near the astronaut, layered buttes
// further out, and the mountain.
float macro(vec2 p) {
  float d = length(p);
  float h = 7.0 * (noise(p / 310.0 + 3.1) - 0.5) + 2.4 * (noise(p / 97.0 + 9.7) - 0.5);
  // Nothing tall within a walk of the astronaut: each far shape fades in.
  float far = smoothstep(260.0, 700.0, d);
  if (far > 0.0) {
    float butte = smoothstep(0.55, 0.66, fbm(p / 560.0 + 17.0, 4));
    h += far * bench(butte * (26.0 + 44.0 * noise(p / 1300.0 + 5.0)), 7.0);
    h += smoothstep(1200.0, 6000.0, d) * 150.0 * (fbm(p / 2400.0 + 40.0, 3) - 0.3);
    vec2 m = (p - MOUNT) / 5200.0;
    h += smoothstep(260.0, 2200.0, d) * bench(exp(-dot(m, m) * 2.2) * 1050.0 * (0.7 + 0.6 * fbm(p / 950.0 + 2.0, 4)), 55.0);
  }
  return h;
}

// One rock per grid cell: a block with flat, uneven faces, as a height above
// the ground. Sizes follow a power law, so most rocks are small.
float rocks(vec2 p, float cell, float rmin, float rmax, float density, uint seed, out float id) {
  vec2 g = p / cell;
  vec2 ic = floor(g);
  uint s = hashu(uvec2(ivec2(ic)) + seed * 7919u);
  id = rnd(s);
  if (rnd(s) > density) return 0.0;
  float size = mix(rmin, rmax, pow(rnd(s), 2.6)) / cell;
  vec2 c = ic + 0.5 + (vec2(rnd(s), rnd(s)) - 0.5) * (1.0 - 3.2 * size);
  vec2 q = (g - c) / size;
  float r2 = dot(q, q);
  if (r2 > 2.4) return 0.0;
  // Longer one way than the other. Steep sides and a low, tilted top: a
  // block, not a cone.
  float turn = rnd(s) * 6.2832;
  vec2 along = vec2(cos(turn), sin(turn));
  q = vec2(dot(q, along), dot(q, vec2(-along.y, along.x)) * mix(1.0, 1.8, rnd(s)));
  float y = (1.5 - sqrt(r2)) * 6.0;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + (rnd(s) - 0.5) * 0.9;
    float steep = mix(1.3, 7.0, rnd(s));
    y = min(y, (mix(0.5, 1.0, rnd(s)) - dot(vec2(cos(a), sin(a)), q)) * steep);
  }
  // Two top faces that meet in a low ridge.
  float top = mix(0.16, 0.85, rnd(s));
  vec2 tilt = (vec2(rnd(s), rnd(s)) - 0.5) * 0.7;
  y = min(y, top + dot(tilt, q));
  tilt = (vec2(rnd(s), rnd(s)) - 0.5) * 0.7;
  y = min(y, top * mix(0.85, 1.25, rnd(s)) + dot(tilt, q));
  vec2 shift = vec2(id * 37.0, id * 91.0);
  y += 0.05 * (noise(q * 6.0 + shift) - 0.5) - rnd(s) * 0.12;
  return max(y, 0.0) * size * cell;
}

// Cracked bedrock: flat plates a little above or below each other, with
// sand-filled joints between them.
float slabs(vec2 p, out float id) {
  vec2 g = (p + 0.12 * vec2(noise(p * 2.1), noise(p * 2.1 + 8.0))) / 0.5;
  ivec2 ic = ivec2(floor(g));
  vec2 f = fract(g);
  float d1 = 8.0;
  float d2 = 8.0;
  id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      uint s = hashu(uvec2(ic + ivec2(i, j)) + 77u);
      vec2 r = vec2(float(i), float(j)) + vec2(rnd(s), rnd(s)) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = rnd(s); }
      else if (d < d2) d2 = d;
    }
  }
  float joint = smoothstep(0.0, 0.07, sqrt(d2) - sqrt(d1));
  return (id - 0.5) * 0.035 + 0.025 * joint - 0.025;
}

// Ground height at p, with the detail a viewer t meters away can see.
// info: x rock cover, y sand, z bedrock, w a random number per rock or plate.
float terrainInfo(vec2 p, float t, out vec4 info) {
  info = vec4(0.0);
  float h = macro(p);
  if (t > 900.0) return h;
  float fade = 1.0 - smoothstep(500.0, 900.0, t);
  float zone = fbm(p / 42.0 + 11.0, 3);
  float sand = 1.0 - smoothstep(0.36, 0.44, zone);
  float bed = smoothstep(0.55, 0.62, zone);
  info.y = sand;
  info.z = bed;

  // Drifts, and on sand the large ripples a walker steps over.
  float m = 0.55 * (noise(p / 12.0) - 0.5) + 0.16 * (noise(p / 3.7 + 4.0) - 0.5);
  if (sand > 0.0 && t < 320.0) {
    vec2 w = p + 1.9 * vec2(noise(p / 5.3), noise(p / 5.3 + 31.0));
    float crest = 1.0 - abs(2.0 * fract(dot(w, vec2(0.83, 0.56)) / 2.4) - 1.0);
    m += sand * 0.12 * pow(crest, 1.5) * (0.4 + 1.2 * noise(p / 9.0 + 2.0)) * (1.0 - smoothstep(160.0, 320.0, t));
  }
  h += m * fade;

  // Rocks in four sizes. The astronaut's own footing is kept clear of the
  // two largest, so the view never starts inside a boulder.
  float clear = smoothstep(0.7, 1.5, length(p));
  float dens = (0.4 + 0.6 * smoothstep(0.3, 0.7, noise(p / 67.0 + 23.0))) * (1.0 - 0.8 * sand);
  float id;
  float r = rocks(p, 8.0, 0.22, 1.25, 0.6 * dens, 1u, id) * fade * clear;
  if (r > 0.0) { h += r; info.x = smoothstep(0.0, 0.02, r); info.w = id; }
  if (t < 110.0) {
    r = rocks(p + 3.3, 1.7, 0.07, 0.34, 0.8 * dens, 2u, id) * (1.0 - smoothstep(60.0, 110.0, t)) * clear;
    if (r > 0.0) { h += r; info.x = max(info.x, smoothstep(0.0, 0.008, r)); info.w = id; }
  }
  if (t < 30.0) {
    r = rocks(p + 7.1, 0.42, 0.022, 0.09, 0.9 * dens, 3u, id) * (1.0 - smoothstep(16.0, 30.0, t));
    if (r > 0.0) { h += r; info.x = max(info.x, smoothstep(0.0, 0.003, r)); info.w = id; }
  }
  if (t < 6.0) {
    r = rocks(p + 1.7, 0.11, 0.007, 0.024, 0.95 * (0.4 + 0.6 * dens), 4u, id) * (1.0 - smoothstep(3.5, 6.0, t));
    if (r > 0.0) { h += r; info.x = max(info.x, smoothstep(0.0, 0.001, r)); info.w = id; }
  }
  if (bed > 0.0 && t < 45.0) {
    float plate = slabs(p, id) * bed * (1.0 - smoothstep(25.0, 45.0, t));
    h += plate;
    if (info.x < 0.5) info.w = id;
  }
  return h;
}
float terrain(vec2 p, float t) {
  vec4 info;
  return terrainInfo(p, t, info);
}
`

// One triangle that covers the screen. It also finds the ground under the
// astronaut once per frame, so the eye height is measured from real footing.
export const VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${TERRAIN}
flat out float vGround;
void main() {
  vGround = terrain(vec2(0.0), 0.0);
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform float uTime;
// Eye position: x east and z north of the footing, y above the ground there.
uniform vec3 uEye;
// Columns: right, up, forward.
uniform mat3 uCam;
uniform float uTanHalf;
uniform float uBarrel;
// Unit vector toward the sun.
uniform vec3 uSun;
// Where the middle of the helmet opening sits, in half screen heights.
uniform vec2 uHelmet;
uniform float uBreath;

flat in float vGround;
out vec4 outColor;
${TERRAIN}
const float TMAX = 16000.0;
const vec3 SUN_LIGHT = vec3(1.0, 0.84, 0.66) * 2.1;
const vec3 SKY_LIGHT = vec3(0.5, 0.36, 0.25) * 0.8;
// Dust in the air, lit. The wind blows toward the east-south-east.
const vec3 AIR_DUST = vec3(0.58, 0.41, 0.275);
const vec2 WIND = vec2(0.94, -0.34);

// The sky of a dusty afternoon: tan, brightest low down, with the blue-white
// glow dust puts around the sun.
vec3 sky(vec3 rd) {
  float y = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.58, 0.4, 0.245), vec3(0.3, 0.195, 0.125), 1.0 - pow(1.0 - y, 3.5));
  float toward = max(dot(rd, uSun), 0.0);
  col += vec3(0.5, 0.39, 0.28) * 0.6 * pow(toward, 5.0);
  col = mix(col, vec3(0.8, 0.87, 1.0) * 1.7, 0.6 * pow(toward, 80.0));
  float off = length(cross(rd, uSun));
  col += vec3(1.0, 0.97, 0.92) * 60.0 * (1.0 - smoothstep(0.0026, 0.0036, off)) * step(0.0, dot(rd, uSun));
  return col;
}

float march(vec3 ro, vec3 rd) {
  float t = 0.3;
  float last = t;
  for (int i = 0; i < 640; i++) {
    vec3 p = ro + rd * t;
    float h = p.y - terrain(p.xz, t);
    if (h < 0.0008 * t) {
      float lo = last;
      float hi = t;
      for (int k = 0; k < 6; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 q = ro + rd * mid;
        if (q.y - terrain(q.xz, mid) < 0.0008 * mid) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    if (t > TMAX || (rd.y > 0.0 && p.y > 1500.0)) break;
    last = t;
    t += max(0.45 * h, 0.01 * t);
  }
  return -1.0;
}

// How much of the sun reaches p, seen from dist meters away.
float shadow(vec3 p, float dist) {
  float lit = 1.0;
  float t = 0.03 + 0.004 * dist;
  for (int i = 0; i < 56; i++) {
    vec3 q = p + uSun * t;
    float h = q.y - terrain(q.xz, dist);
    lit = min(lit, 16.0 * h / t);
    if (lit < 0.0 || q.y > 1500.0) break;
    t += max(0.7 * h, 0.02 + 0.004 * dist + 0.01 * t);
  }
  return smoothstep(0.0, 1.0, lit);
}

vec3 ground(vec3 p, float t, vec3 rd) {
  vec4 info;
  float h0 = terrainInfo(p.xz, t, info);
  float e = max(0.0015, 0.0011 * t);
  vec2 d = vec2(e, 0.0);
  vec3 n = normalize(vec3(
    terrain(p.xz - d.xy, t) - terrain(p.xz + d.xy, t),
    2.0 * e,
    terrain(p.xz - d.yx, t) - terrain(p.xz + d.yx, t)));
  float slope = 1.0 - n.y;

  // Hollows and rock bases get less sky.
  float reach = 0.05 + 0.02 * t;
  float around = 0.25 * (terrain(p.xz + vec2(reach, 0.0), t) + terrain(p.xz - vec2(reach, 0.0), t)
    + terrain(p.xz + vec2(0.0, reach), t) + terrain(p.xz - vec2(0.0, reach), t));
  float open = clamp(1.0 + 2.2 * (h0 - around) / reach, 0.35, 1.15);

  // Grain too fine to march: it only roughens the shading.
  float near = 1.0 - smoothstep(2.0, 7.0, t);
  float mid = 1.0 - smoothstep(15.0, 50.0, t);
  vec2 q = p.xz;
  vec2 grain = (vec2(noise(q * 90.0), noise(q * 90.0 + 17.0)) - 0.5) * 0.5 * near
    + (vec2(noise(q * 14.0), noise(q * 14.0 + 9.0)) - 0.5) * 0.3 * mid
    + (vec2(noise(q * 2.3), noise(q * 2.3 + 5.0)) - 0.5) * 0.16 * (1.0 - smoothstep(120.0, 400.0, t));
  // Small wind ripples on sand, a hand's width apart.
  float fine = info.y * (1.0 - info.x) * (1.0 - smoothstep(6.0, 18.0, t));
  if (fine > 0.0) {
    vec2 w = q + 0.25 * vec2(noise(q / 0.9), noise(q / 0.9 + 13.0));
    grain += vec2(0.83, 0.56) * cos(dot(w, vec2(0.83, 0.56)) * 6.2832 / 0.11) * 0.22 * fine;
  }
  n = normalize(n + vec3(grain.x, 0.0, grain.y) * (1.0 - 0.35 * info.x));

  // Bright dust, dark sand, pale bedrock, dark rock with dust on top.
  vec3 dust = vec3(0.34, 0.215, 0.14);
  vec3 col = mix(dust, dust * vec3(0.72, 0.7, 0.7), smoothstep(0.35, 0.7, fbm(q / 7.0, 4)));
  col = mix(col, vec3(0.175, 0.115, 0.085), 0.85 * info.y);
  col = mix(col, vec3(0.33, 0.22, 0.15) * (0.82 + 0.36 * info.w), info.z * (1.0 - info.y));
  col *= 0.93 + 0.14 * fbm(ROT * q * 19.0, 3) * mid + 0.14 * (noise(q * 0.55) - 0.5);
  // Darker patches where coarse grains gather, and gravel too small to march.
  float patches = smoothstep(0.35, 0.75, fbm(ROT * q * 1.3 + 40.0, 4)) * (1.0 - smoothstep(30.0, 120.0, t));
  float flecks = smoothstep(0.72, 0.84, noise(ROT * q * 53.0 + 3.0)) * near;
  col *= 1.0 - (0.13 * patches + 0.35 * flecks) * (1.0 - 0.7 * info.y);
  vec3 rock = vec3(0.15, 0.11, 0.095) * (0.6 + 0.8 * info.w);
  rock *= 0.8 + 0.4 * fbm(ROT * q * 9.0 + p.y * 7.0, 3);
  rock = mix(rock, dust * 0.9, 0.7 * smoothstep(0.82, 0.97, n.y));
  col = mix(col, rock, info.x);
  // Far scarps show their layers.
  float far = smoothstep(200.0, 900.0, t);
  float band = noise(vec2(p.y * 0.45, 3.0)) * 0.6 + noise(vec2(p.y * 1.7, 9.0)) * 0.4;
  col = mix(col, mix(vec3(0.2, 0.135, 0.1), vec3(0.4, 0.27, 0.185), band), far * smoothstep(0.03, 0.2, slope) * 0.85);
  col = mix(col, vec3(0.21, 0.14, 0.105), far * 0.5 * smoothstep(0.42, 0.6, fbm(q / 900.0 + 60.0, 3)));

  float sun = max(dot(n, uSun), 0.0);
  if (sun > 0.0) sun *= shadow(p + n * (0.004 + 0.0015 * t), t);
  vec3 light = SUN_LIGHT * sun
    + SKY_LIGHT * (0.45 + 0.55 * n.y) * open
    + vec3(0.2, 0.12, 0.07) * (0.5 - 0.5 * n.y) * open;
  col *= light;
  // Dusty ground is brightest looking straight down-sun.
  col *= 1.0 + 0.22 * pow(max(dot(-rd, uSun), 0.0), 6.0);

  // Wind-blown dust running low over the ground, in streaks along the wind.
  vec2 lane = vec2(dot(q, vec2(-WIND.y, WIND.x)) * 0.55, dot(q, WIND) * 0.06 - uTime * 0.55);
  float streak = smoothstep(0.5, 0.74, fbm(lane + 0.6 * noise(lane * 0.5 + uTime * 0.1), 4));
  streak *= smoothstep(1.5, 8.0, t) * (1.0 - smoothstep(90.0, 260.0, t));
  return mix(col, AIR_DUST * (0.7 + 0.5 * sun), 0.38 * streak);
}

// A dust devil crossing the plain some 250 m south. Returns how much of the
// view it hides along this ray, short of limit meters.
float devil(vec3 ro, vec3 rd, float limit) {
  vec2 base = vec2(-150.0 + 5.0 * mod(uTime, 60.0), -260.0);
  vec2 o = ro.xz - base;
  float along = dot(rd.xz, rd.xz);
  if (along < 1e-5) return 0.0;
  float s = -dot(o, rd.xz) / along;
  if (s < 1.0 || s > limit) return 0.0;
  float y = ro.y + rd.y * s - vGround;
  float up = y / 150.0;
  if (up < -0.02 || up > 1.0) return 0.0;
  // The column leans and wanders as it climbs, and widens toward the top.
  vec2 lean = vec2(7.0 * sin(y * 0.035 + uTime * 0.9), 5.0 * sin(y * 0.05 - uTime * 0.7)) * up;
  float dist = length(o + rd.xz * s - lean);
  float radius = (5.0 + 20.0 * up * up) * (1.0 + 0.2 * sin(y * 0.09 + uTime * 1.7));
  float body = smoothstep(radius, 0.2 * radius, dist) * (1.0 - smoothstep(0.55, 1.0, up));
  return 0.85 * body * (0.55 + 0.45 * noise(vec2(dist * 0.35 + uTime * 2.0, y * 0.11 - uTime * 3.0)));
}

// Dust grains drifting past close to the visor. They hold their place in
// the world, so they slide across the view when the head turns.
float motes(vec3 rd, float scale, float speed, uint seed) {
  vec2 a = vec2(atan(rd.x, rd.z), rd.y) * scale + vec2(uTime * speed, uTime * speed * 0.15);
  uint s = hashu(uvec2(ivec2(floor(a))) + seed * 613u);
  if (rnd(s) > 0.3) return 0.0;
  vec2 at = 0.15 + 0.7 * vec2(rnd(s), rnd(s));
  return smoothstep(0.07, 0.0, length(fract(a) - at)) * rnd(s);
}

vec3 tonemap(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;

  // The helmet opening, in coordinates fixed to the helmet.
  vec2 hq = uv - uHelmet;
  vec2 he = vec2(hq.x / (aspect * 1.045), (hq.y - 0.02) / 1.075);
  float hr = pow(pow(abs(he.x), 3.6) + pow(abs(he.y), 3.6), 1.0 / 3.6);
  float rim = smoothstep(0.955, 1.0, hr);

  vec3 col = vec3(0.0);
  vec3 rd = normalize(uCam * vec3(uv * (1.0 + uBarrel * dot(uv, uv)) * uTanHalf, 1.0));
  if (rim < 1.0) {
    vec3 ro = vec3(uEye.x, vGround + uEye.y, uEye.z);
    float t = march(ro, rd);
    vec3 haze = sky(normalize(vec3(rd.x, 0.03 + 0.25 * max(rd.y, 0.0), rd.z)));
    if (t > 0.0) {
      col = ground(ro + rd * t, t, rd);
      col = mix(haze, col, exp(-t * 8.5e-5));
    } else {
      col = sky(rd);
      // Rays that ran out of range under the horizon end in haze.
      col = mix(col, haze, smoothstep(0.0, -0.02, rd.y));
    }
    float column = devil(ro, rd, t > 0.0 ? t : TMAX);
    col = mix(col, AIR_DUST * (0.75 + 0.5 * pow(max(dot(rd, uSun), 0.0), 2.0)), column);
    col = pow(tonemap(col * 0.85), vec3(1.0 / 2.2));

    // The visor: glass that darkens toward its edge, dust that lights up
    // facing the sun, and breath on the lower part.
    float toward = max(dot(rd, uSun), 0.0);
    col += vec3(1.0, 0.86, 0.7) * 0.2 * pow(toward, 14.0);
    float edge = smoothstep(0.6, 0.98, hr);
    col = col * (1.0 - 0.3 * edge * edge) + vec3(0.05, 0.045, 0.04) * 0.5 * edge * edge;
    vec2 sg = hq * 170.0;
    float speck = smoothstep(0.997, 1.0, hashf(ivec2(floor(sg)))) * smoothstep(0.4, 0.05, length(fract(sg) - 0.5));
    float smudge = smoothstep(0.45, 0.8, fbm(hq * 3.0 + 5.0, 3));
    col += (0.5 * speck + 0.035 * smudge) * pow(toward, 3.0) * vec3(1.0, 0.9, 0.78);
    col += (motes(rd, 13.0, 1.3, 1u) + 0.7 * motes(rd, 29.0, 3.1, 2u)) * (0.1 + 0.3 * toward * toward) * vec3(1.0, 0.88, 0.74);
    float fog = uBreath * smoothstep(0.5, 1.0, hr) * smoothstep(0.1, -0.8, he.y) * (0.4 + 0.6 * fbm(hq * 4.0 + vec2(0.0, uTime * 0.04), 3));
    col = mix(col, vec3(0.62, 0.6, 0.58), 0.24 * fog);
  }

  // The rim is close to the eye, so it is dark and out of focus. Its inner
  // lip catches light from the sky and, on the sun's side, the sun.
  vec3 sunCam = transpose(uCam) * uSun;
  float lip = exp(-pow((hr - 1.025) / 0.022, 2.0));
  vec3 shell = vec3(0.026, 0.027, 0.03) + 0.022 * smoothstep(1.4, 1.03, hr);
  shell += lip * mix(vec3(0.16, 0.115, 0.085), vec3(0.24, 0.185, 0.14), 0.5 + 0.5 * he.y);
  shell += 0.05 * exp(-pow((hr - 1.11) / 0.03, 2.0));
  shell += lip * vec3(0.6, 0.5, 0.4) * pow(max(dot(normalize(hq + 1e-4), normalize(sunCam.xy + 1e-4)), 0.0), 10.0) * smoothstep(-0.3, 0.4, sunCam.z);
  col = mix(col, shell, rim);

  col += (hashf(ivec2(gl_FragCoord.xy) + ivec2(int(uTime * 60.0) * 131)) - 0.5) * 0.014;
  outColor = vec4(col, 1.0);
}
`
