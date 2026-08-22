/**
 * GPU particle systems: rain streaks, wildfire smoke/embers, and landslide
 * debris. All state lives in storage buffers; compute passes advance them and
 * vertex shaders pull instances directly (no CPU round-trips).
 *
 * Visual scales are proportional to the world size so the same code reads
 * correctly for a 2 km procedural world and a 24 km real-DEM world.
 */

import { GLOBALS_WGSL, GRID_WGSL, UTIL_WGSL } from "./common";

/**
 * Particle counts are per-screenful, not per-region. Everything here is only
 * drawn once the camera is close enough for an individual drop or ember to
 * mean something (see G.district.y), so these are sized for a town-scale view
 * rather than for covering a province.
 */
export const RAIN_COUNT = 14000;
export const FIRE_PARTICLE_COUNT = 8192;
export const DEBRIS_COUNT = 16384;

const BILLBOARD_WGSL = /* wgsl */ `
const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

fn billboardAxes(worldPos: vec3f) -> mat2x3f {
  let toCam = normalize(G.camPos.xyz - worldPos);
  var right = cross(vec3f(0.0, 1.0, 0.0), toCam);
  let len = length(right);
  if (len < 1e-4) { right = vec3f(1.0, 0.0, 0.0); } else { right /= len; }
  let up = normalize(cross(toCam, right));
  return mat2x3f(right, up);
}
`;

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------

const RAIN_COMPUTE_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var<storage, read_write> parts : array<vec4f>;
@group(0) @binding(2) var heightTex : texture_2d<f32>;
@group(0) @binding(3) var waterTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&parts)) { return; }
  var p = parts[i];
  let dt = G.misc.w;
  let world = G.world.x;
  // Heavy-snow scenarios swap rain streaks for slow, fluttering snow.
  let snow = clamp(G.weather.x * 4.0, 0.0, 1.0);
  let fall = world * mix(
    0.010 + 0.006 * fract(p.w),
    0.0016 + 0.0008 * fract(p.w),
    snow,
  );

  p.y -= fall * dt;
  p.x += (G.rain.z * fall * 0.03 +
    sin(G.camPos.w * 1.7 + p.w * 40.0) * world * 0.0006 * snow) * dt;
  p.z += (G.rain.w * fall * 0.03 +
    cos(G.camPos.w * 1.3 + p.w * 33.0) * world * 0.0006 * snow) * dt;

  let cell = worldToCell(p.xyz);
  let ground = textureLoad(heightTex, cell, 0).r + textureLoad(waterTex, cell, 0).r;
  if (p.y < ground || p.x < 0.0 || p.z < 0.0 || p.x > world || p.z > world) {
    let seed = i * 3u + u32(G.camPos.w * 331.0);
    let r = rand2(seed);
    // Concentrate rain around the camera so density holds up on large maps.
    let viewRadius = clamp(
      (G.camPos.y - G.layers.z) * 1.4, world * 0.05, world * 0.5);
    let radius = viewRadius * sqrt(r.x);
    let angle = r.y * 6.2831853;
    p.x = clamp(G.misc.x + cos(angle) * radius, 0.0, world);
    p.z = clamp(G.misc.y + sin(angle) * radius, 0.0, world);
    p.y = G.misc.z + rand01(seed ^ 0x51edu) * world * 0.12;
  }
  parts[i] = p;
}
`;

const RAIN_RENDER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var<storage, read> parts : array<vec4f>;
${UTIL_WGSL}
${BILLBOARD_WGSL}

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) alpha : f32,
  @location(1) uv : vec2f,
};

@vertex
fn vs(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = parts[iid];
  let corner = CORNERS[vid];
  let world = G.world.x;
  let snow = clamp(G.weather.x * 4.0, 0.0, 1.0);
  let fall = world * mix(
    0.010 + 0.006 * fract(p.w),
    0.0016 + 0.0008 * fract(p.w),
    snow,
  );
  let dir = normalize(vec3f(G.rain.z * fall * 0.03, -fall, G.rain.w * fall * 0.03));
  let width = world * 0.00013 * (1.0 + 4.0 * snow);
  let halfLen = mix(fall * 0.115, width * 1.6, snow);

  let toCam = normalize(G.camPos.xyz - p.xyz);
  var side = cross(dir, toCam);
  let sideLen = length(side);
  if (sideLen < 1e-3) { side = vec3f(1.0, 0.0, 0.0); } else { side /= sideLen; }
  let pos = p.xyz + dir * (corner.y * halfLen) + side * (corner.x * width);

  var out : VSOut;
  out.pos = G.viewProj * vec4f(pos, 1.0);
  out.alpha = mix(0.09 + 0.15 * G.rain.x, 0.42, snow) * G.district.y;
  out.uv = corner;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let snow = clamp(G.weather.x * 4.0, 0.0, 1.0);
  let col = mix(vec3f(0.62, 0.68, 0.80), vec3f(0.95, 0.96, 1.0), snow);
  // Snowflakes are soft rounded specks rather than streaks.
  let mask = 1.0 - smoothstep(0.45, 1.0, length(in.uv));
  return vec4f(col, in.alpha * mix(1.0, mask, snow));
}
`;

// ---------------------------------------------------------------------------
// Fire smoke & embers. pos = (xyz, lifeRemaining); vel = (xyz, maxLife).
// maxLife < 2 seconds means "ember", otherwise "smoke".
// ---------------------------------------------------------------------------

const FIRE_COMPUTE_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var<storage, read_write> parts : array<vec4f>;
@group(0) @binding(2) var heightTex : texture_2d<f32>;
@group(0) @binding(3) var fireTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i * 2u + 1u >= arrayLength(&parts)) { return; }
  var pos = parts[i * 2u];
  var vel = parts[i * 2u + 1u];
  let dt = G.misc.w;
  let world = G.world.x;

  if (pos.w <= 0.0) {
    let seed = i * 7u + u32(G.camPos.w * 149.0);
    let n = u32(G.world.z);
    let cell = vec2i(
      i32(rand01(seed) * f32(n - 1u)),
      i32(rand01(seed ^ 0x77u) * f32(n - 1u)),
    );
    let fire = textureLoad(fireTex, cell, 0);
    if (fire.g > 0.15 && rand01(seed ^ 0x1234u) < 0.5) {
      let h = textureLoad(heightTex, cell, 0).r;
      let jitter = (rand2(seed ^ 0x8181u) - 0.5) * G.world.y * 1.5;
      let base = cellWorld(cell, h + world * 0.0015);
      let isEmber = rand01(seed ^ 0x4444u) < 0.3;
      var maxLife = 3.0 + rand01(seed ^ 0x9c9cu) * 3.5;
      if (isEmber) { maxLife = 0.6 + rand01(seed ^ 0x9c9cu) * 1.0; }
      pos = vec4f(base.x + jitter.x, base.y, base.z + jitter.y, maxLife);
      vel = vec4f(
        G.rain.z * 2.0 + (rand01(seed ^ 0x11u) - 0.5) * world * 0.002,
        world * (0.0025 + rand01(seed ^ 0x22u) * 0.0035),
        G.rain.w * 2.0 + (rand01(seed ^ 0x33u) - 0.5) * world * 0.002,
        maxLife,
      );
    }
  } else {
    pos = vec4f(pos.xyz + vel.xyz * dt, pos.w - dt);
    let isEmber = vel.w < 2.0;
    if (isEmber) {
      vel.y -= world * 0.004 * dt;
    } else {
      vel.y += world * 0.0009 * dt;
      vel.x += G.rain.z * 0.6 * dt;
      vel.z += G.rain.w * 0.6 * dt;
    }
  }
  parts[i * 2u] = pos;
  parts[i * 2u + 1u] = vel;
}
`;

const FIRE_RENDER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var<storage, read> parts : array<vec4f>;
${UTIL_WGSL}
${BILLBOARD_WGSL}

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) data : vec4f, // x seed, y age fraction, z is-ember, w alpha
};

@vertex
fn vs(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = parts[iid * 2u];
  let vel = parts[iid * 2u + 1u];
  var out : VSOut;
  if (p.w <= 0.0) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.uv = vec2f(0.0);
    out.data = vec4f(0.0);
    return out;
  }
  let corner = CORNERS[vid];
  let world = G.world.x;
  let isEmber = select(0.0, 1.0, vel.w < 2.0);
  let age = vel.w - p.w;
  let ageFrac = clamp(age / vel.w, 0.0, 1.0);
  let lifeFrac = clamp(p.w / vel.w, 0.0, 1.0);
  let seed = rand01(iid * 977u);

  var size = world * (0.0026 + age * 0.0024) * (0.8 + seed * 0.5);
  var alpha = 0.30 * lifeFrac;
  if (isEmber > 0.5) {
    size = world * 0.0007;
    alpha = 0.9 * lifeFrac;
  }
  alpha *= G.district.y;

  // Smoke puffs tumble slowly as they rise.
  let ang = seed * 6.2831 + age * (seed - 0.5) * 1.6;
  let ca = cos(ang);
  let sa = sin(ang);
  let ruv = vec2f(corner.x * ca - corner.y * sa, corner.x * sa + corner.y * ca);

  let axes = billboardAxes(p.xyz);
  let pos = p.xyz + axes[0] * (corner.x * size) + axes[1] * (corner.y * size);
  out.pos = G.viewProj * vec4f(pos, 1.0);
  out.uv = ruv;
  out.data = vec4f(seed, ageFrac, isEmber, alpha);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let r = length(in.uv);
  if (in.data.z > 0.5) {
    // Ember: hot flickering core with a soft halo.
    let flicker = 0.75 + 0.25 * sin(G.camPos.w * 22.0 + in.data.x * 80.0);
    let core = 1.0 - smoothstep(0.0, 0.45, r);
    let halo = 1.0 - smoothstep(0.2, 1.0, r);
    let col = vec3f(1.0, 0.62, 0.2) * core * 1.4 +
      vec3f(1.0, 0.35, 0.08) * halo * 0.5;
    return vec4f(col * flicker, in.data.w * max(core, halo * 0.5) * flicker);
  }
  // Smoke: billowing puff shaped by two octaves of value noise.
  let seedOff = in.data.x * 37.0;
  var n = valueNoise2(in.uv * 2.6 + vec2f(seedOff, seedOff * 1.7)) * 0.65;
  n += valueNoise2(in.uv * 6.1 + vec2f(seedOff * 2.3, seedOff)) * 0.35;
  let body = 1.0 - smoothstep(0.25, 1.0, r);
  let density = smoothstep(0.30, 0.72, n * 0.75 + body * 0.55) * body;
  // Young smoke is lit from the fire below; old smoke fades to pale gray.
  let shade = mix(vec3f(0.16, 0.15, 0.14), vec3f(0.42, 0.42, 0.43), in.data.y);
  let glow = vec3f(0.95, 0.42, 0.10) *
    (1.0 - smoothstep(0.0, 0.3, in.data.y)) * (1.0 - r) * 0.8;
  return vec4f(shade + glow, in.data.w * density);
}
`;

// ---------------------------------------------------------------------------
// Landslide debris. pos = (xyz, lifeRemaining); vel = (xyz, unused).
// ---------------------------------------------------------------------------

const DEBRIS_COMPUTE_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var<storage, read_write> parts : array<vec4f>;
@group(0) @binding(2) var heightTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

fn heightAt(p: vec3f) -> f32 {
  return textureLoad(heightTex, worldToCell(p), 0).r;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i * 2u + 1u >= arrayLength(&parts)) { return; }
  var pos = parts[i * 2u];
  var vel = parts[i * 2u + 1u];
  let dt = G.misc.w;
  let world = G.world.x;
  let cs = G.world.y;

  // Spawn burst requested by the CPU for this frame.
  let start = u32(G.debris.x);
  let count = u32(G.debris.y);
  if (count > 0u && i >= start && i < start + count) {
    let seed = i * 13u + u32(G.camPos.w * 523.0);
    let r = rand2(seed);
    let center = vec3f(G.debris.z * world, 0.0, G.debris.w * world);
    let radius = world * 0.012 * sqrt(r.x);
    let angle = r.y * 6.2831853;
    var p = vec3f(center.x + cos(angle) * radius, 0.0, center.z + sin(angle) * radius);
    p.y = heightAt(p) + world * 0.001;
    // vel.w doubles as the initial life so the renderer can fade in.
    let life = 9.0 + rand01(seed ^ 0xeeu) * 4.0;
    pos = vec4f(p, life);
    vel = vec4f(0.0, 0.0, 0.0, life);
  }

  if (pos.w > 0.0) {
    let cell = worldToCell(pos.xyz);
    let hx = textureLoad(heightTex, clampCell(cell + vec2i(1, 0)), 0).r -
             textureLoad(heightTex, clampCell(cell + vec2i(-1, 0)), 0).r;
    let hy = textureLoad(heightTex, clampCell(cell + vec2i(0, 1)), 0).r -
             textureLoad(heightTex, clampCell(cell + vec2i(0, -1)), 0).r;
    let grad = vec2f(hx, hy) / (2.0 * cs);
    let accelScale = 9.81 * 3.2 * (world / 2048.0);
    vel.x -= grad.x * accelScale * dt;
    vel.z -= grad.y * accelScale * dt;
    let friction = 1.0 / (1.0 + 2.4 * dt);
    vel.x *= friction;
    vel.z *= friction;
    pos.x = clamp(pos.x + vel.x * dt, cs, world - cs);
    pos.z = clamp(pos.z + vel.z * dt, cs, world - cs);
    pos.y = heightAt(pos.xyz) + world * 0.0008;

    let speed = length(vel.xz);
    var drain = 0.22;
    if (speed < world * 0.0006) { drain = 1.1; }
    pos.w -= drain * dt;
  }

  parts[i * 2u] = pos;
  parts[i * 2u + 1u] = vel;
}
`;

const DEBRIS_RENDER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var<storage, read> parts : array<vec4f>;
${UTIL_WGSL}
${BILLBOARD_WGSL}

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) color : vec4f,
  @location(1) uv : vec2f,
  @location(2) seed : f32,
};

@vertex
fn vs(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = parts[iid * 2u];
  let vel = parts[iid * 2u + 1u];
  var out : VSOut;
  if (p.w <= 0.0) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.color = vec4f(0.0);
    out.uv = vec2f(0.0);
    out.seed = 0.0;
    return out;
  }
  let corner = CORNERS[vid];
  let world = G.world.x;
  let seed = fract(vel.w);
  // Grow in over the first moments instead of popping into existence.
  let age = max(vel.w - p.w, 0.0);
  let fadeIn = smoothstep(0.0, 0.7, age);
  let size = world * (0.0010 + seed * 0.0016) * (0.55 + 0.45 * fadeIn);

  // Rocks tumble while the flow is moving.
  let speed = length(vel.xz);
  let ang = seed * 6.2831 +
    G.camPos.w * (0.5 + seed * 2.5) * clamp(speed / (world * 0.001), 0.0, 1.5);
  let ca = cos(ang);
  let sa = sin(ang);
  let ruv = vec2f(corner.x * ca - corner.y * sa, corner.x * sa + corner.y * ca);

  let axes = billboardAxes(p.xyz);
  let pos = p.xyz + axes[0] * (corner.x * size) + axes[1] * (corner.y * size);
  let shade = 0.7 + seed * 0.5;
  out.pos = G.viewProj * vec4f(pos, 1.0);
  out.color = vec4f(
    applyFog(tonemap(vec3f(0.30, 0.24, 0.17) * shade), pos),
    clamp(p.w / 1.5, 0.0, 1.0) * fadeIn * G.district.y,
  );
  out.uv = ruv;
  out.seed = seed;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let a = atan2(in.uv.y, in.uv.x);
  // Jagged rocky silhouette instead of a plain disc.
  let edge = 0.62 + 0.16 * sin(a * 3.0 + in.seed * 17.0) +
    0.12 * sin(a * 7.0 + in.seed * 41.0) +
    0.06 * sin(a * 13.0 + in.seed * 89.0);
  if (r > edge) { discard; }
  // Fake volume: lit from the upper-left, crevices from noise, dark rim.
  let lightDir = normalize(vec2f(-0.5, 0.75));
  let ndl = 0.72 + 0.38 * dot(in.uv / max(edge, 0.2), lightDir);
  let crevice = 0.85 + 0.3 * valueNoise2(in.uv * 5.0 + vec2f(in.seed * 23.0, in.seed * 51.0));
  let rim = 1.0 - smoothstep(edge * 0.55, edge, r) * 0.35;
  return vec4f(in.color.rgb * ndl * crevice * rim, in.color.a);
}
`;

// ---------------------------------------------------------------------------

export interface ParticleTargets {
  format: GPUTextureFormat;
  sampleCount: number;
  depthFormat: GPUTextureFormat;
}

interface RenderOptions {
  depthWrite: boolean;
}

function makeRenderPipeline(
  device: GPUDevice,
  label: string,
  code: string,
  targets: ParticleTargets,
  options: RenderOptions,
): GPURenderPipeline {
  const module = device.createShaderModule({ label, code });
  return device.createRenderPipeline({
    label,
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [
        {
          format: targets.format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: targets.depthFormat,
      depthWriteEnabled: options.depthWrite,
      depthCompare: "less",
    },
    multisample: { count: targets.sampleCount },
  });
}

function makeComputePipeline(
  device: GPUDevice,
  label: string,
  code: string,
): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: "auto",
    compute: { module: device.createShaderModule({ label, code }) },
  });
}

export class ParticleSystems {
  private readonly rainCompute: GPUComputePipeline;
  private readonly rainRender: GPURenderPipeline;
  private readonly rainComputeBG: GPUBindGroup;
  private readonly rainRenderBG: GPUBindGroup;
  readonly rainBuffer: GPUBuffer;

  private readonly fireCompute: GPUComputePipeline;
  private readonly fireRender: GPURenderPipeline;
  private readonly fireComputeBG: GPUBindGroup;
  private readonly fireRenderBG: GPUBindGroup;
  readonly fireBuffer: GPUBuffer;

  private readonly debrisCompute: GPUComputePipeline;
  private readonly debrisRender: GPURenderPipeline;
  private readonly debrisComputeBG: GPUBindGroup;
  private readonly debrisRenderBG: GPUBindGroup;
  readonly debrisBuffer: GPUBuffer;

  constructor(
    device: GPUDevice,
    globals: GPUBuffer,
    heightTex: GPUTexture,
    waterTex: GPUTexture,
    fireTex: GPUTexture,
    targets: ParticleTargets,
    worldSize: number,
  ) {
    this.rainBuffer = device.createBuffer({
      label: "rain-particles",
      size: RAIN_COUNT * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.rainBuffer, 0, initialRainData(worldSize));

    this.fireBuffer = device.createBuffer({
      label: "fire-particles",
      size: FIRE_PARTICLE_COUNT * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.debrisBuffer = device.createBuffer({
      label: "debris-particles",
      size: DEBRIS_COUNT * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.rainCompute = makeComputePipeline(
      device,
      "rain-compute",
      RAIN_COMPUTE_WGSL,
    );
    this.fireCompute = makeComputePipeline(
      device,
      "fire-particle-compute",
      FIRE_COMPUTE_WGSL,
    );
    this.debrisCompute = makeComputePipeline(
      device,
      "debris-compute",
      DEBRIS_COMPUTE_WGSL,
    );

    this.rainRender = makeRenderPipeline(
      device,
      "rain-render",
      RAIN_RENDER_WGSL,
      targets,
      {
        depthWrite: false,
      },
    );
    this.fireRender = makeRenderPipeline(
      device,
      "fire-particle-render",
      FIRE_RENDER_WGSL,
      targets,
      {
        depthWrite: false,
      },
    );
    this.debrisRender = makeRenderPipeline(
      device,
      "debris-render",
      DEBRIS_RENDER_WGSL,
      targets,
      {
        depthWrite: true,
      },
    );

    const globalsEntry = { binding: 0, resource: { buffer: globals } };
    this.rainComputeBG = device.createBindGroup({
      layout: this.rainCompute.getBindGroupLayout(0),
      entries: [
        globalsEntry,
        { binding: 1, resource: { buffer: this.rainBuffer } },
        { binding: 2, resource: heightTex.createView() },
        { binding: 3, resource: waterTex.createView() },
      ],
    });
    this.rainRenderBG = device.createBindGroup({
      layout: this.rainRender.getBindGroupLayout(0),
      entries: [
        globalsEntry,
        { binding: 1, resource: { buffer: this.rainBuffer } },
      ],
    });
    this.fireComputeBG = device.createBindGroup({
      layout: this.fireCompute.getBindGroupLayout(0),
      entries: [
        globalsEntry,
        { binding: 1, resource: { buffer: this.fireBuffer } },
        { binding: 2, resource: heightTex.createView() },
        { binding: 3, resource: fireTex.createView() },
      ],
    });
    this.fireRenderBG = device.createBindGroup({
      layout: this.fireRender.getBindGroupLayout(0),
      entries: [
        globalsEntry,
        { binding: 1, resource: { buffer: this.fireBuffer } },
      ],
    });
    this.debrisComputeBG = device.createBindGroup({
      layout: this.debrisCompute.getBindGroupLayout(0),
      entries: [
        globalsEntry,
        { binding: 1, resource: { buffer: this.debrisBuffer } },
        { binding: 2, resource: heightTex.createView() },
      ],
    });
    this.debrisRenderBG = device.createBindGroup({
      layout: this.debrisRender.getBindGroupLayout(0),
      entries: [
        globalsEntry,
        { binding: 1, resource: { buffer: this.debrisBuffer } },
      ],
    });
  }

  compute(pass: GPUComputePassEncoder, fireActive: boolean): void {
    pass.setPipeline(this.rainCompute);
    pass.setBindGroup(0, this.rainComputeBG);
    pass.dispatchWorkgroups(Math.ceil(RAIN_COUNT / 64));
    if (fireActive) {
      pass.setPipeline(this.fireCompute);
      pass.setBindGroup(0, this.fireComputeBG);
      pass.dispatchWorkgroups(Math.ceil(FIRE_PARTICLE_COUNT / 64));
    }
    pass.setPipeline(this.debrisCompute);
    pass.setBindGroup(0, this.debrisComputeBG);
    pass.dispatchWorkgroups(Math.ceil(DEBRIS_COUNT / 64));
  }

  /** Draw order: debris (writes depth) -> smoke/embers -> rain. */
  draw(
    pass: GPURenderPassEncoder,
    rainInstances: number,
    fireActive: boolean,
  ): void {
    pass.setPipeline(this.debrisRender);
    pass.setBindGroup(0, this.debrisRenderBG);
    pass.draw(6, DEBRIS_COUNT);
    if (fireActive) {
      pass.setPipeline(this.fireRender);
      pass.setBindGroup(0, this.fireRenderBG);
      pass.draw(6, FIRE_PARTICLE_COUNT);
    }
    if (rainInstances > 0) {
      pass.setPipeline(this.rainRender);
      pass.setBindGroup(0, this.rainRenderBG);
      pass.draw(6, rainInstances);
    }
  }
}

export function initialRainData(worldSize: number): Float32Array {
  const data = new Float32Array(RAIN_COUNT * 4);
  for (let i = 0; i < RAIN_COUNT; i++) {
    data[i * 4] = Math.random() * worldSize;
    data[i * 4 + 1] = Math.random() * worldSize * 0.4;
    data[i * 4 + 2] = Math.random() * worldSize;
    data[i * 4 + 3] = Math.random();
  }
  return data;
}
