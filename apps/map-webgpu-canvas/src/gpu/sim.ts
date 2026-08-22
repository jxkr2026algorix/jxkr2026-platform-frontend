/**
 * Grid simulations: shallow-water (virtual pipe model), wildfire cellular
 * automaton, and the stats/candidate reduction pass.
 *
 * Texture conventions (all gridSize x gridSize):
 * - height: r32float, terrain height in meters (static).
 * - waterA/waterB: r32float, standing water depth in meters.
 * - fluxA/fluxB: rgba32float outflow per direction (x:+x, y:-x, z:+y, w:-y).
 * - fireA/fireB: rgba32float (r fuel, g burning, b char, a wetness).
 *
 * The "current" state after each frame is always the A set: water substeps
 * run in pairs (A->B->A) and fire ticks copy B back to A.
 */

import { GLOBALS_WGSL, GRID_WGSL, UTIL_WGSL } from "./common";

const WATER_FLUX_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var waterTex : texture_2d<f32>;
@group(0) @binding(3) var fluxTex : texture_2d<f32>;
@group(0) @binding(4) var fluxOut : texture_storage_2d<rgba32float, write>;
${GRID_WGSL}

fn surface(c: vec2i) -> f32 {
  let cc = clampCell(c);
  return textureLoad(heightTex, cc, 0).r + textureLoad(waterTex, cc, 0).r;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = gridN();
  let c = vec2i(gid.xy);
  if (c.x >= n || c.y >= n) { return; }

  let dt = G.sim.x;
  let cs = G.world.y;
  let w = textureLoad(waterTex, c, 0).r;
  let here = surface(c);
  let old = textureLoad(fluxTex, c, 0);
  let k = dt * 9.81 * cs * 0.55;

  var f = vec4f(
    max(0.0, old.x * 0.9985 + k * (here - surface(c + vec2i(1, 0)))),
    max(0.0, old.y * 0.9985 + k * (here - surface(c + vec2i(-1, 0)))),
    max(0.0, old.z * 0.9985 + k * (here - surface(c + vec2i(0, 1)))),
    max(0.0, old.w * 0.9985 + k * (here - surface(c + vec2i(0, -1)))),
  );
  let total = (f.x + f.y + f.z + f.w) * dt;
  if (total > 1e-6) {
    f *= min(1.0, w * cs * cs / total);
  }
  if (w < 1e-5) {
    f = vec4f(0.0);
  }
  textureStore(fluxOut, c, f);
}
`;

const WATER_HEIGHT_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var waterTex : texture_2d<f32>;
@group(0) @binding(2) var fluxTex : texture_2d<f32>;
@group(0) @binding(3) var waterOut : texture_storage_2d<r32float, write>;
${GRID_WGSL}
${UTIL_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = gridN();
  let c = vec2i(gid.xy);
  if (c.x >= n || c.y >= n) { return; }

  // Border cells drain off the map.
  if (c.x == 0 || c.y == 0 || c.x == n - 1 || c.y == n - 1) {
    textureStore(waterOut, c, vec4f(0.0));
    return;
  }

  let dt = G.sim.x;
  let cs = G.world.y;
  let out = textureLoad(fluxTex, c, 0);
  let inflow =
    textureLoad(fluxTex, c + vec2i(-1, 0), 0).x +
    textureLoad(fluxTex, c + vec2i(1, 0), 0).y +
    textureLoad(fluxTex, c + vec2i(0, -1), 0).z +
    textureLoad(fluxTex, c + vec2i(0, 1), 0).w;
  let outflow = out.x + out.y + out.z + out.w;

  var w = textureLoad(waterTex, c, 0).r;
  w += dt * (inflow - outflow) / (cs * cs);
  // Demo-scaled rainfall inflow, minus infiltration/evaporation. Drainage is
  // strong enough that uplands shed their film while valleys, fed by routed
  // inflow from the whole catchment, keep accumulating.
  // Rain falls on a footprint, not on the whole province. Uniform inflow over
  // 300 km spreads a sheet a millimetre deep everywhere and pools nowhere;
  // concentrating it is what makes water gather in the valleys below it.
  let ruv = (vec2f(f32(c.x), f32(c.y)) + vec2f(0.5)) / f32(gridN());
  let rd = length(ruv - G.rainArea.xy) / max(G.rainArea.z, 1e-4);
  // Feathered edge plus a little noise, so the band is a weather cell rather
  // than a circle stamped on the terrain.
  let edgeNoise = 0.86 + 0.28 * valueNoise2(ruv * 9.0 + vec2f(G.sim.z * 0.02));
  let footprint = select(
    1.0 - smoothstep(1.0 - G.rainArea.w, 1.0, rd / edgeNoise),
    1.0,
    G.rainArea.z >= 9.0,
  );
  w += G.rain.y * footprint * dt;
  w -= (0.026 * (1.0 + G.weather.z * 6.0) + w * 0.015) * dt;
  // Localized water burst (map:trigger flood / map click).
  if (G.fx.z > 1.5 && G.fx.z < 2.5) {
    let uv = (vec2f(f32(c.x), f32(c.y)) + 0.5) / f32(n);
    let d = distance(uv, G.fx.xy);
    let r = 8.0 / f32(n);
    if (d < r) {
      w += 0.7 * (1.0 - d / r) * dt;
    }
  }
  // Tsunami: raise a mound of water offshore and let the shallow-water
  // solver carry it into the coast.
  if (G.fx.z > 2.5 && G.fx.z < 3.5) {
    let uv = (vec2f(f32(c.x), f32(c.y)) + 0.5) / f32(n);
    let d = distance(uv, G.fx.xy);
    let r = 32.0 / f32(n);
    if (d < r) {
      w += 16.0 * (1.0 - d / r) * dt;
    }
  }
  w = clamp(w, 0.0, 60.0);
  textureStore(waterOut, c, vec4f(w, 0.0, 0.0, 0.0));
}
`;

const FIRE_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var waterTex : texture_2d<f32>;
@group(0) @binding(3) var fireTex : texture_2d<f32>;
@group(0) @binding(4) var fireOut : texture_storage_2d<rgba32float, write>;
${GRID_WGSL}
${UTIL_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = gridN();
  let c = vec2i(gid.xy);
  if (c.x >= n || c.y >= n) { return; }

  let dt = G.sim.y;
  var cell = textureLoad(fireTex, c, 0);
  var fuel = cell.r;
  var burning = cell.g;
  var charred = cell.b;
  var wet = cell.a;

  let water = textureLoad(waterTex, c, 0).r;
  // Ground dries quickly once the rain stops so back-to-back scenarios
  // work; heatwave and drought dry it out even faster.
  let heatDry = max(G.weather.y, 0.0) * 0.05 + G.weather.z * 0.12;
  let drying = 0.004 + (1.0 - min(G.rain.x * 8.0, 1.0)) * (0.06 + heatDry);
  wet = clamp(wet + G.rain.x * 0.28 * dt - drying * dt, 0.0, 1.0);
  if (water > 0.04) { wet = 1.0; }

  let myHeight = textureLoad(heightTex, c, 0).r;
  let seed = u32(c.x) * 1973u + u32(c.y) * 9277u + u32(G.sim.z * 997.0) * 26699u;

  if (burning > 0.02) {
    let burnRate = burning * dt * 0.55;
    fuel = max(0.0, fuel - burnRate);
    charred = min(1.0, charred + burnRate * 0.9);
    var decay = 0.985;
    if (fuel < 0.05) { decay = 0.86; }
    if (wet > 0.45) { decay = mix(decay, 0.62, (wet - 0.45) * 2.2); }
    burning *= pow(decay, dt * 10.0);
    if (burning < 0.02) { burning = 0.0; }
  } else if (fuel > 0.08 && wet < 0.6) {
    var exposure = 0.0;
    let wind = vec2f(G.rain.z, G.rain.w);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) { continue; }
        let nb = clampCell(c + vec2i(dx, dy));
        let nbBurn = textureLoad(fireTex, nb, 0).g;
        if (nbBurn < 0.05) { continue; }
        let offset = vec2f(f32(dx), f32(dy));
        let windAlign = 1.0 + 1.3 * max(0.0, dot(normalize(-offset), normalize(wind + vec2f(1e-4))));
        let nbHeight = textureLoad(heightTex, nb, 0).r;
        let upslope = exp(clamp((myHeight - nbHeight) / G.world.y, -1.0, 1.0) * 0.9);
        exposure += nbBurn * windAlign * upslope / max(1.0, length(offset));
      }
    }
    let dryness = (1.0 - wet) * (1.0 - wet);
    // Spread probability is scaled down on coarse cells so the front moves
    // at a believable pace regardless of map resolution.
    let cellFactor = clamp(sqrt(94.0 / G.world.y), 0.3, 1.2);
    let climate = 1.0 + G.weather.z * 0.8 + max(G.weather.y, 0.0) * 0.35;
    let p = exposure * 0.55 * cellFactor * climate * dryness *
      clamp(fuel * 1.6, 0.0, 1.0) * dt;
    if (rand01(seed) < p) {
      burning = 0.7 + rand01(seed ^ 0xabcdu) * 0.3;
    }
  }

  // Manual / scenario ignition; dry out a wider ring so fire can take hold.
  if (G.fx.z > 0.5 && G.fx.z < 1.5) {
    let uv = (vec2f(f32(c.x), f32(c.y)) + 0.5) / f32(n);
    let d = distance(uv, G.fx.xy);
    if (d < 8.0 / f32(n)) {
      wet *= 0.15;
    }
    if (d < 2.5 / f32(n) && fuel > 0.03) {
      burning = 1.0;
      wet = 0.0;
    }
  }

  textureStore(fireOut, c, vec4f(fuel, burning, charred, wet));
}
`;

const STATS_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var waterTex : texture_2d<f32>;
@group(0) @binding(3) var fireTex : texture_2d<f32>;
struct Stats {
  flooded : atomic<u32>,
  burning : atomic<u32>,
  maxRisk : atomic<u32>,
  candidateCount : atomic<u32>,
  candidates : array<u32, 64>,
};
@group(0) @binding(4) var<storage, read_write> stats : Stats;
${GRID_WGSL}
${UTIL_WGSL}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = gridN();
  let c = vec2i(gid.xy);
  if (c.x >= n || c.y >= n) { return; }

  let w = textureLoad(waterTex, c, 0).r;
  if (w > 0.15) { atomicAdd(&stats.flooded, 1u); }
  if (textureLoad(fireTex, c, 0).g > 0.05) { atomicAdd(&stats.burning, 1u); }

  let cs = G.world.y;
  let hx = textureLoad(heightTex, clampCell(c + vec2i(1, 0)), 0).r -
           textureLoad(heightTex, clampCell(c + vec2i(-1, 0)), 0).r;
  let hy = textureLoad(heightTex, clampCell(c + vec2i(0, 1)), 0).r -
           textureLoad(heightTex, clampCell(c + vec2i(0, -1)), 0).r;
  let slopeMag = length(vec2f(hx, hy)) / (2.0 * cs);
  let risk = landslideRisk(slopeMag, w);
  atomicMax(&stats.maxRisk, u32(risk * 1000.0));
  if (risk > 0.85) {
    let idx = atomicAdd(&stats.candidateCount, 1u);
    if (idx < 64u) {
      stats.candidates[idx] = u32(c.x) | (u32(c.y) << 16u);
    }
  }
}
`;

export const STATS_BUFFER_SIZE = 4 * 4 + 64 * 4;

function computePipeline(
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

export interface GridTextures {
  height: GPUTexture;
  waterA: GPUTexture;
  waterB: GPUTexture;
  fluxA: GPUTexture;
  fluxB: GPUTexture;
  fireA: GPUTexture;
  fireB: GPUTexture;
}

export class GridSim {
  private readonly flux: GPUComputePipeline;
  private readonly height: GPUComputePipeline;
  private readonly fire: GPUComputePipeline;
  private readonly stats: GPUComputePipeline;
  private readonly fluxBGs: [GPUBindGroup, GPUBindGroup];
  private readonly heightBGs: [GPUBindGroup, GPUBindGroup];
  private readonly fireBG: GPUBindGroup;
  private readonly statsBG: GPUBindGroup;
  private readonly workgroups: number;

  readonly statsBuffer: GPUBuffer;

  constructor(
    device: GPUDevice,
    globals: GPUBuffer,
    textures: GridTextures,
    gridSize: number,
  ) {
    this.workgroups = Math.ceil(gridSize / 8);
    this.flux = computePipeline(device, "water-flux", WATER_FLUX_WGSL);
    this.height = computePipeline(device, "water-height", WATER_HEIGHT_WGSL);
    this.fire = computePipeline(device, "fire", FIRE_WGSL);
    this.stats = computePipeline(device, "stats", STATS_WGSL);

    this.statsBuffer = device.createBuffer({
      label: "stats",
      size: STATS_BUFFER_SIZE,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    const heightView = textures.height.createView();
    const fluxEntries = (
      water: GPUTexture,
      fluxIn: GPUTexture,
      fluxOut: GPUTexture,
    ) =>
      device.createBindGroup({
        layout: this.flux.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: globals } },
          { binding: 1, resource: heightView },
          { binding: 2, resource: water.createView() },
          { binding: 3, resource: fluxIn.createView() },
          { binding: 4, resource: fluxOut.createView() },
        ],
      });
    this.fluxBGs = [
      fluxEntries(textures.waterA, textures.fluxA, textures.fluxB),
      fluxEntries(textures.waterB, textures.fluxB, textures.fluxA),
    ];

    const heightEntries = (
      waterIn: GPUTexture,
      fluxIn: GPUTexture,
      waterOut: GPUTexture,
    ) =>
      device.createBindGroup({
        layout: this.height.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: globals } },
          { binding: 1, resource: waterIn.createView() },
          { binding: 2, resource: fluxIn.createView() },
          { binding: 3, resource: waterOut.createView() },
        ],
      });
    this.heightBGs = [
      heightEntries(textures.waterA, textures.fluxB, textures.waterB),
      heightEntries(textures.waterB, textures.fluxA, textures.waterA),
    ];

    this.fireBG = device.createBindGroup({
      layout: this.fire.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: heightView },
        { binding: 2, resource: textures.waterA.createView() },
        { binding: 3, resource: textures.fireA.createView() },
        { binding: 4, resource: textures.fireB.createView() },
      ],
    });

    this.statsBG = device.createBindGroup({
      layout: this.stats.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: heightView },
        { binding: 2, resource: textures.waterA.createView() },
        { binding: 3, resource: textures.fireA.createView() },
        { binding: 4, resource: { buffer: this.statsBuffer } },
      ],
    });
  }

  /** One pair of water substeps: A -> B -> A. */
  waterStepPair(pass: GPUComputePassEncoder): void {
    for (const parity of [0, 1] as const) {
      pass.setPipeline(this.flux);
      pass.setBindGroup(0, this.fluxBGs[parity]);
      pass.dispatchWorkgroups(this.workgroups, this.workgroups);
      pass.setPipeline(this.height);
      pass.setBindGroup(0, this.heightBGs[parity]);
      pass.dispatchWorkgroups(this.workgroups, this.workgroups);
    }
  }

  /** Fire tick A -> B; caller must copy B back to A afterwards. */
  fireTick(pass: GPUComputePassEncoder): void {
    pass.setPipeline(this.fire);
    pass.setBindGroup(0, this.fireBG);
    pass.dispatchWorkgroups(this.workgroups, this.workgroups);
  }

  statsPass(pass: GPUComputePassEncoder): void {
    pass.setPipeline(this.stats);
    pass.setBindGroup(0, this.statsBG);
    pass.dispatchWorkgroups(this.workgroups, this.workgroups);
  }
}
