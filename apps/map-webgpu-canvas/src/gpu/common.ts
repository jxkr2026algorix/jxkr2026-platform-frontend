/**
 * Shared WGSL prelude and the CPU<->GPU globals uniform layout.
 *
 * Every pipeline binds the same globals uniform buffer at
 * @group(0) @binding(0). The Float32Array layout in `GlobalsWriter`
 * must match `GLOBALS_WGSL` field-for-field.
 */

export const GLOBALS_FLOATS = 72; // 288 bytes

export const GLOBALS_WGSL = /* wgsl */ `
struct Globals {
  viewProj : mat4x4f,
  camPos : vec4f,   // xyz camera position, w time (seconds)
  sunDir : vec4f,   // xyz direction toward the sun, w storm factor 0..1
  world : vec4f,    // x world size (m), y cell size (m), z grid size, w flatBlend
  rain : vec4f,     // x rainfall 0..1 (of max), y rain inflow m/s, z windX, w windZ
  sim : vec4f,      // x water dt, y fire dt, z sim time, w saturation index
  fx : vec4f,       // x trigger u, y trigger v, z trigger kind (1 fire, 2 water), w overlay 0..1
  fog : vec4f,      // rgb fog color, w fog density
  misc : vec4f,     // x cam target x, y cam target z, z rain spawn top, w frame dt
  debris : vec4f,   // x spawn start index, y spawn count, z center u, w center v
  layers : vec4f,   // x satellite blend, y scenario code, z min height, w max height
  event : vec4f,    // x source u, y source v, z elapsed s, w kind (1 quake, 3 nuclear, 4 chemical)
  weather : vec4f,  // x snow 0..1, y temperature -1 cold..1 heat, z drought 0..1, w street-map blend
  detail : vec4f,   // high-zoom patch: x u0, y v0, z size (normalized), w blend
  district : vec4f, // x boundary-overlay blend, y particle visibility, zw reserved
};
@group(0) @binding(0) var<uniform> G : Globals;
`;

export const UTIL_WGSL = /* wgsl */ `
fn pcg(v: u32) -> u32 {
  var state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn rand01(seed: u32) -> f32 {
  return f32(pcg(seed)) / 4294967295.0;
}

fn rand2(seed: u32) -> vec2f {
  return vec2f(rand01(seed), rand01(seed ^ 0x9e3779b9u));
}

fn hash2f(p: vec2i) -> f32 {
  return rand01(u32(p.x) * 374761393u + u32(p.y) * 668265263u);
}

fn valueNoise2(p: vec2f) -> f32 {
  let ip = vec2i(floor(p));
  let fp = fract(p);
  let s = fp * fp * (3.0 - 2.0 * fp);
  let a = hash2f(ip);
  let b = hash2f(ip + vec2i(1, 0));
  let c = hash2f(ip + vec2i(0, 1));
  let d = hash2f(ip + vec2i(1, 1));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn tonemap(color: vec3f) -> vec3f {
  var mapped = color / (color + vec3f(0.72));
  mapped = clamp(mapped * 1.5, vec3f(0.0), vec3f(1.0));
  // Vibrance: push saturation back that the curve took away.
  let luma = dot(mapped, vec3f(0.299, 0.587, 0.114));
  mapped = clamp(mix(vec3f(luma), mapped, 1.28), vec3f(0.0), vec3f(1.0));
  return pow(mapped, vec3f(1.0 / 2.2));
}

fn applyFog(color: vec3f, worldPos: vec3f) -> vec3f {
  let dist = length(worldPos - G.camPos.xyz);
  let f = 1.0 - exp(-dist * G.fog.w);
  return mix(color, G.fog.rgb, f);
}

// Slope-failure risk shared by the stats pass and the terrain overlay.
// Coarse province-scale cells average out local slopes, so scale slope up
// with the cell size to keep the risk index comparable across resolutions.
fn landslideRisk(slopeMag: f32, waterDepth: f32) -> f32 {
  let slopeAdj = slopeMag * max(1.0, sqrt(G.world.y / 94.0));
  let slope01 = smoothstep(0.3, 0.85, slopeAdj);
  return slope01 * clamp(G.sim.w * 1.1 + waterDepth * 0.4, 0.0, 1.4);
}
`;

/** Grid helpers used by every shader that reads the terrain textures. */
export const GRID_WGSL = /* wgsl */ `
fn gridN() -> i32 { return i32(G.world.z); }

fn clampCell(c: vec2i) -> vec2i {
  let n = gridN() - 1;
  return vec2i(clamp(c.x, 0, n), clamp(c.y, 0, n));
}

fn cellWorld(c: vec2i, height: f32) -> vec3f {
  let cs = G.world.y;
  return vec3f((f32(c.x) + 0.5) * cs, height, (f32(c.y) + 0.5) * cs);
}

fn worldToCell(p: vec3f) -> vec2i {
  let cs = G.world.y;
  return clampCell(vec2i(i32(p.x / cs), i32(p.z / cs)));
}
`;

export class GlobalsWriter {
  readonly buffer: GPUBuffer;
  readonly data = new Float32Array(GLOBALS_FLOATS);

  constructor(private readonly device: GPUDevice) {
    this.buffer = device.createBuffer({
      label: "globals",
      size: GLOBALS_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  upload(): void {
    this.device.queue.writeBuffer(this.buffer, 0, this.data);
  }

  setMat4(offset: number, m: Float32Array): void {
    this.data.set(m, offset);
  }

  setVec4(row: number, x: number, y: number, z: number, w: number): void {
    const base = 16 + row * 4;
    this.data[base] = x;
    this.data[base + 1] = y;
    this.data[base + 2] = z;
    this.data[base + 3] = w;
  }
}

/** Row indices for GlobalsWriter.setVec4, matching GLOBALS_WGSL order. */
export const ROW = {
  camPos: 0,
  sunDir: 1,
  world: 2,
  rain: 3,
  sim: 4,
  fx: 5,
  fog: 6,
  misc: 7,
  debris: 8,
  layers: 9,
  event: 10,
  weather: 11,
  detail: 12,
  district: 13,
} as const;

export function createGridTexture(
  device: GPUDevice,
  label: string,
  format: GPUTextureFormat,
  gridSize: number,
  extraUsage: GPUTextureUsageFlags = 0,
): GPUTexture {
  return device.createTexture({
    label,
    size: [gridSize, gridSize],
    format,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      extraUsage,
  });
}
