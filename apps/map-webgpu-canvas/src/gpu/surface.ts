/**
 * Terrain and water surface rendering. Both draw the same (gridSize^2)
 * vertex grid via vertex pulling from the simulation textures, so the water
 * surface always matches the simulated state with zero CPU involvement.
 *
 * Terrain blends three looks: a cartographic "flat map" style, a natural
 * palette, and (when loaded) draped satellite imagery. Fire char/glow,
 * wetness, and the landslide-risk overlay are applied on top.
 */

import { GLOBALS_WGSL, GRID_WGSL, UTIL_WGSL } from "./common";

const TERRAIN_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var waterTex : texture_2d<f32>;
@group(0) @binding(3) var fireTex : texture_2d<f32>;
@group(0) @binding(4) var satTex : texture_2d<f32>;
@group(0) @binding(5) var satSampler : sampler;
@group(0) @binding(6) var riskTex : texture_2d<f32>;
@group(0) @binding(7) var zoneTex : texture_2d<f32>;
@group(0) @binding(8) var streetTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let n = u32(G.world.z);
  let i = i32(vid % n);
  let j = i32(vid / n);
  let csv = G.world.x / f32(n - 1u);
  let h = textureLoad(heightTex, vec2i(i, j), 0).r;

  let hL = textureLoad(heightTex, clampCell(vec2i(i - 1, j)), 0).r;
  let hR = textureLoad(heightTex, clampCell(vec2i(i + 1, j)), 0).r;
  let hN = textureLoad(heightTex, clampCell(vec2i(i, j - 1)), 0).r;
  let hS = textureLoad(heightTex, clampCell(vec2i(i, j + 1)), 0).r;

  var out : VSOut;
  out.worldPos = vec3f(f32(i) * csv, h, f32(j) * csv);
  out.normal = normalize(vec3f(hL - hR, 2.0 * csv, hN - hS));
  out.uv = vec2f(f32(i), f32(j)) / f32(n - 1u);
  out.clip = G.viewProj * vec4f(out.worldPos, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let n = i32(G.world.z);
  let cell = clampCell(vec2i(in.uv * f32(n - 1) + 0.5));
  let fire = textureLoad(fireTex, cell, 0);
  let water = textureLoad(waterTex, cell, 0).r;
  let normal = normalize(in.normal);
  let heightNorm = clamp(
    (in.worldPos.y - G.layers.z) / max(G.layers.w - G.layers.z, 1.0), 0.0, 1.0);

  // Natural palette driven by remaining fuel (vegetation) and slope.
  let slopeMag = length(normal.xz) / max(normal.y, 0.05);
  let rockiness = smoothstep(0.45, 1.1, slopeMag);
  let veg = mix(vec3f(0.44, 0.53, 0.28), vec3f(0.16, 0.33, 0.15), clamp(fire.r * 1.4, 0.0, 1.0));
  let rock = mix(vec3f(0.48, 0.44, 0.38), vec3f(0.62, 0.59, 0.54), heightNorm);
  var natural = mix(veg, rock, max(rockiness, smoothstep(0.75, 0.98, heightNorm)));

  // Cartographic flat-map style with soft hypsometric tint and contours.
  var mapStyle = mix(vec3f(0.90, 0.91, 0.89), vec3f(0.74, 0.67, 0.52), pow(heightNorm, 0.7));
  mapStyle = mix(mapStyle, vec3f(0.66, 0.80, 0.58), clamp(fire.r, 0.0, 1.0) * 0.7);
  let contourStep = max((G.layers.w - G.layers.z) / 14.0, 1.0);
  let contour = fract(in.worldPos.y / contourStep);
  let contourLine = 1.0 - smoothstep(0.0, 0.06, min(contour, 1.0 - contour));
  mapStyle = mix(mapStyle, vec3f(0.62, 0.64, 0.66), contourLine * 0.35);

  // Satellite imagery is muted; boost its saturation and lift it a touch.
  // Dark pixels (deep water) get less boost so lakes keep a natural hue.
  var sat = textureSampleLevel(satTex, satSampler, in.uv, 0.0).rgb;
  let satLuma = dot(sat, vec3f(0.299, 0.587, 0.114));
  let satBoost = mix(1.02, 1.28, smoothstep(0.08, 0.30, satLuma));
  sat = clamp(mix(vec3f(satLuma), sat, satBoost) * 1.03, vec3f(0.0), vec3f(1.0));
  // Street-map basemap (Google-Maps-like) cross-fades over the satellite.
  let street = textureSampleLevel(streetTex, satSampler, in.uv, 0.0).rgb;
  let baseImg = mix(sat, street, G.weather.w);
  let satBlend = G.layers.x;
  var albedo = mix(natural, baseImg, satBlend);
  albedo = mix(albedo, mapStyle, G.world.w * (1.0 - satBlend));

  // Fire: char first, then glow. Wetness darkens the ground.
  albedo = mix(albedo, vec3f(0.09, 0.08, 0.07), clamp(fire.b * 1.3, 0.0, 0.95));
  albedo *= 1.0 - 0.22 * fire.a;

  // Snow cover creeps down from the peaks, never fully erasing the map.
  let snowCover = clamp((heightNorm * 1.5 - 0.12) * G.weather.x + G.weather.x * 0.28, 0.0, 0.72);
  albedo = mix(albedo, vec3f(0.90, 0.92, 0.96), snowCover);
  let albLuma = dot(albedo, vec3f(0.299, 0.587, 0.114));
  albedo = mix(albedo, vec3f(albLuma) * vec3f(1.18, 0.98, 0.62), G.weather.z * 0.45);

  // Hazard-susceptibility zone overlay for the active scenario, drawn as a
  // hatched tint so it reads as an analytical layer over the basemap.
  let risk = landslideRisk(slopeMag, water);
  let riskStatic = textureLoad(riskTex, cell, 0);
  let sc = G.layers.y;
  var zone = 0.0;
  var zoneColor = vec3f(0.0);
  if (sc > 0.5 && sc < 2.5) {
    // Rain / flood: channels and valley floors that collect water.
    zone = smoothstep(0.25, 0.8, riskStatic.r);
    zoneColor = vec3f(0.10, 0.36, 0.95);
  } else if (sc < 3.5) {
    // Wildfire: only the densest dry fuel, kept subtle so the whole
    // forest does not wash orange.
    zone = smoothstep(0.55, 1.0, fire.r * (1.0 - fire.a)) * 0.6;
    zoneColor = vec3f(1.0, 0.45, 0.05);
  } else if (sc < 4.5) {
    // Landslide: steep faces, sharpened by live saturation.
    zone = smoothstep(0.3, 0.9, max(risk, riskStatic.g * clamp(G.sim.w * 1.4, 0.0, 1.0)));
    zoneColor = vec3f(0.92, 0.15, 0.08);
  } else if (sc < 5.5) {
    // Typhoon: compound flood exposure.
    zone = smoothstep(0.25, 0.8, riskStatic.r);
    zoneColor = vec3f(0.10, 0.36, 0.95);
  } else if (sc < 6.5) {
    // Earthquake: liquefaction-prone soft lowland soils.
    zone = smoothstep(0.3, 0.8, riskStatic.r) * (1.0 - smoothstep(0.15, 0.4, heightNorm));
    zoneColor = vec3f(0.85, 0.45, 0.15);
  } else if (sc < 7.5) {
    // Tsunami: low-lying coastal strips.
    zone = 1.0 - smoothstep(0.015, 0.07, heightNorm);
    zoneColor = vec3f(0.05, 0.55, 0.78);
  } else if (sc < 9.5) {
    // Nuclear / chemical: the plume itself is the overlay.
    zone = 0.0;
  } else if (sc < 10.5) {
    // Heatwave: flat lowland basins where heat pools.
    zone = (1.0 - riskStatic.g) * (1.0 - smoothstep(0.18, 0.45, heightNorm)) * 0.8;
    zoneColor = vec3f(0.98, 0.35, 0.08);
  } else if (sc < 11.5) {
    // Cold wave: exposed highlands.
    zone = smoothstep(0.35, 0.75, heightNorm);
    zoneColor = vec3f(0.25, 0.45, 0.92);
  } else if (sc < 12.5) {
    // Heavy snow: mountain districts at risk of isolation.
    zone = smoothstep(0.32, 0.68, heightNorm) * 0.8;
    zoneColor = vec3f(0.35, 0.45, 0.68);
  } else {
    // Drought: water-supply channels running dry.
    zone = smoothstep(0.25, 0.8, riskStatic.r);
    zoneColor = vec3f(0.78, 0.56, 0.12);
  }
  let hatch = 0.7 + 0.3 * step(0.5, fract((in.worldPos.x + in.worldPos.z) / (G.world.x * 0.005)));
  albedo = mix(albedo, zoneColor, G.fx.w * zone * 0.42 * hatch);

  // Externally supplied risk-zone polygons (map:set-zones), pre-rasterized
  // into a texture; bilinear sampling keeps the edges smooth.
  let zoneFill = textureSampleLevel(zoneTex, satSampler, in.uv, 0.0);
  albedo = mix(albedo, zoneFill.rgb, zoneFill.a * G.fx.w * 0.8);

  // Point-source events: earthquake shockwave and airborne plumes.
  var extraGlow = vec3f(0.0);
  let ek = G.event.w;
  if (ek > 0.5) {
    let src = vec2f(G.event.x, G.event.y) * G.world.x;
    let rel = in.worldPos.xz - src;
    if (ek < 1.5) {
      // Expanding shockwave ring plus a persistent local intensity field.
      let d = length(rel);
      let ringR = G.event.z * G.world.x * 0.012;
      let band = exp(-abs(d - ringR) / (G.world.x * 0.012));
      let atten = clamp(1.0 - d / (G.world.x * 0.25), 0.0, 1.0)
        * exp(-G.event.z * 0.03);
      albedo = mix(albedo, vec3f(0.9, 0.3, 0.1), atten * 0.55);
      extraGlow += vec3f(1.0, 0.85, 0.6) * band
        * clamp(1.0 - d / (G.world.x * 0.6), 0.0, 1.0)
        * exp(-G.event.z * 0.06) * 0.9;
    } else if (ek > 2.5) {
      // Gaussian plume spreading downwind from the source.
      let wind = vec2f(G.rain.z, G.rain.w);
      let wlen = max(length(wind), 0.5);
      let wdir = wind / wlen;
      let along = dot(rel, wdir);
      let crossd = abs(dot(rel, vec2f(-wdir.y, wdir.x)));
      // Spread speed scales with the world so province and town views both
      // show the plume growing over tens of seconds.
      let front = G.event.z * wlen * 40.0 * max(1.0, G.world.x / 24000.0);
      var conc = 0.0;
      if (along > -G.world.x * 0.004 && along < front) {
        let sigma = G.world.x * 0.005 + along * 0.30;
        conc = exp(-crossd * crossd / (2.0 * sigma * sigma))
          * exp(-max(along, 0.0) / (G.world.x * 0.55))
          * (1.0 - smoothstep(front * 0.8, front, along));
      }
      var pcol = vec3f(0.65, 0.2, 0.8);
      if (ek > 3.5) { pcol = vec3f(0.7, 0.72, 0.1); }
      albedo = mix(albedo, pcol, clamp(conc, 0.0, 1.0) * 0.55);
      if (ek < 3.5) {
        // Emergency-planning-zone rings around the plant.
        let d = length(rel);
        let rw = G.world.x;
        var ring = 1.0 - smoothstep(0.0, rw * 0.0012, abs(d - rw * 0.03));
        ring += 1.0 - smoothstep(0.0, rw * 0.0012, abs(d - rw * 0.06));
        ring += 1.0 - smoothstep(0.0, rw * 0.0012, abs(d - rw * 0.12));
        albedo = mix(albedo, pcol, clamp(ring, 0.0, 1.0) * 0.5);
      }
    }
  }

  let storm = G.sunDir.w;
  let diff = max(dot(normal, G.sunDir.xyz), 0.0);
  let sunI = 1.15 * (1.0 - storm * 0.4);
  var light = 0.42 + diff * sunI;
  // Flatten lighting toward pure cartography in map mode without imagery.
  light = mix(light, 0.82 + diff * 0.3, G.world.w * (1.0 - satBlend));
  // Satellite imagery already contains baked shading; ease off the sun.
  light = mix(light, 0.74 + diff * 0.55, satBlend);
  // Gentle valley occlusion adds depth to the relief.
  light *= 1.0 - riskStatic.r * 0.14;

  let hash = rand01(u32(cell.x) * 613u + u32(cell.y) * 1231u);
  let flicker = 0.75 + 0.45 * sin(G.camPos.w * 9.0 + hash * 21.0);
  // Neighboring burn adds a soft glow halo around the fire front.
  let glowSum = (
    textureLoad(fireTex, clampCell(cell + vec2i(1, 0)), 0).g +
    textureLoad(fireTex, clampCell(cell + vec2i(-1, 0)), 0).g +
    textureLoad(fireTex, clampCell(cell + vec2i(0, 1)), 0).g +
    textureLoad(fireTex, clampCell(cell + vec2i(0, -1)), 0).g
  ) * 0.25;
  let emissive = vec3f(1.0, 0.34, 0.07) * fire.g * flicker * 2.4 +
    vec3f(1.0, 0.30, 0.05) * glowSum * 0.9;

  var color = albedo * light + emissive + extraGlow;
  // Temperature grade: heatwaves warm the frame, cold waves chill it.
  let heatT = max(G.weather.y, 0.0);
  let coldT = max(-G.weather.y, 0.0);
  color *= mix(vec3f(1.0), vec3f(1.07, 1.0, 0.9), heatT);
  color *= mix(vec3f(1.0), vec3f(0.9, 0.96, 1.08), coldT);
  color = applyFog(color, in.worldPos);
  return vec4f(tonemap(color), 1.0);
}
`;

const WATER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var waterTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) normal : vec3f,
  @location(2) depth : f32,
};

fn surfaceAt(c: vec2i) -> f32 {
  let cc = clampCell(c);
  return textureLoad(heightTex, cc, 0).r + textureLoad(waterTex, cc, 0).r;
}

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let n = u32(G.world.z);
  let i = i32(vid % n);
  let j = i32(vid / n);
  let csv = G.world.x / f32(n - 1u);
  let h = textureLoad(heightTex, vec2i(i, j), 0).r;
  let w = textureLoad(waterTex, vec2i(i, j), 0).r;

  var y = h + w;
  if (w < 0.02) {
    y = h - G.world.x * 0.002;
  }

  let sL = surfaceAt(vec2i(i - 1, j));
  let sR = surfaceAt(vec2i(i + 1, j));
  let sN = surfaceAt(vec2i(i, j - 1));
  let sS = surfaceAt(vec2i(i, j + 1));

  var out : VSOut;
  out.worldPos = vec3f(f32(i) * csv, y, f32(j) * csv);
  out.normal = normalize(vec3f(sL - sR, 2.0 * csv, sN - sS));
  out.depth = w;
  out.clip = G.viewProj * vec4f(out.worldPos, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  if (in.depth < 0.015) { discard; }
  // Animated ripples perturb the analytic surface normal.
  let k = 6.2831 / (G.world.x / 300.0);
  let t = G.camPos.w;
  let ripA = sin(in.worldPos.x * k + t * 2.1) +
    sin(in.worldPos.z * k * 1.31 - t * 1.6) * 0.7;
  let ripB = sin((in.worldPos.x + in.worldPos.z) * k * 0.73 + t * 2.5) +
    sin(in.worldPos.x * k * 0.51 - t * 1.9) * 0.6;
  let rippleAmp = 0.03 + G.rain.x * 0.05;
  let normal = normalize(normalize(in.normal) + vec3f(ripA, 0.0, ripB) * rippleAmp);
  let viewDir = normalize(G.camPos.xyz - in.worldPos);
  let depthFactor = 1.0 - exp(-in.depth * 1.8);

  var color = mix(vec3f(0.16, 0.42, 0.55), vec3f(0.03, 0.14, 0.24), depthFactor);
  // Heavy rain turns flood water muddy.
  color = mix(color, vec3f(0.30, 0.27, 0.15), G.rain.x * 0.25 * depthFactor);
  // Map mode reads as flat cartographic blue.
  color = mix(color, vec3f(0.25, 0.55, 0.80), G.world.w * 0.75);

  let storm = G.sunDir.w;
  let spec = pow(max(dot(reflect(-G.sunDir.xyz, normal), viewDir), 0.0), 60.0)
    * (1.0 - storm * 0.7) * 0.45;
  let sparkleSeed = (u32(in.worldPos.x * 7.1) * 2654435761u) ^
    u32(in.worldPos.z * 7.7) ^ u32(G.camPos.w * 41.0);
  let sparkle = rand01(sparkleSeed) * G.rain.x * 0.10;

  let diff = 0.45 + 0.55 * max(dot(normal, G.sunDir.xyz), 0.0) * (1.0 - storm * 0.5);
  var lit = color * diff + vec3f(spec + sparkle);
  // Shoreline foam where the water thins out.
  let foam = smoothstep(0.30, 0.05, in.depth) * smoothstep(0.015, 0.04, in.depth);
  lit += vec3f(0.85, 0.88, 0.9) * foam * 0.30;
  lit = applyFog(lit, in.worldPos);
  let alpha = clamp(0.42 + 0.55 * depthFactor + G.world.w * 0.2, 0.0, 0.94);
  return vec4f(tonemap(lit), alpha);
}
`;

export interface SurfaceTargets {
  format: GPUTextureFormat;
  sampleCount: number;
  depthFormat: GPUTextureFormat;
}

export class SurfaceRenderer {
  private readonly terrain: GPURenderPipeline;
  private readonly water: GPURenderPipeline;
  private terrainBG: GPUBindGroup;
  private readonly waterBG: GPUBindGroup;
  private readonly indexBuffer: GPUBuffer;
  private readonly indexCount: number;
  private buildTerrainBG!: (streetView: GPUTextureView) => GPUBindGroup;

  constructor(
    device: GPUDevice,
    globals: GPUBuffer,
    heightTex: GPUTexture,
    waterTex: GPUTexture,
    fireTex: GPUTexture,
    satTex: GPUTexture,
    riskTex: GPUTexture,
    zoneTex: GPUTexture,
    streetTex: GPUTexture,
    gridSize: number,
    targets: SurfaceTargets,
  ) {
    const terrainModule = device.createShaderModule({
      label: "terrain",
      code: TERRAIN_WGSL,
    });
    this.terrain = device.createRenderPipeline({
      label: "terrain",
      layout: "auto",
      vertex: { module: terrainModule, entryPoint: "vs" },
      fragment: {
        module: terrainModule,
        entryPoint: "fs",
        targets: [{ format: targets.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: targets.depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
      multisample: { count: targets.sampleCount },
    });

    const waterModule = device.createShaderModule({
      label: "water-surface",
      code: WATER_WGSL,
    });
    this.water = device.createRenderPipeline({
      label: "water-surface",
      layout: "auto",
      vertex: { module: waterModule, entryPoint: "vs" },
      fragment: {
        module: waterModule,
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
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: targets.depthFormat,
        depthWriteEnabled: false,
        depthCompare: "less",
      },
      multisample: { count: targets.sampleCount },
    });

    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.buildTerrainBG = (streetView: GPUTextureView) =>
      device.createBindGroup({
        layout: this.terrain.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: globals } },
          { binding: 1, resource: heightTex.createView() },
          { binding: 2, resource: waterTex.createView() },
          { binding: 3, resource: fireTex.createView() },
          { binding: 4, resource: satTex.createView() },
          { binding: 5, resource: sampler },
          { binding: 6, resource: riskTex.createView() },
          { binding: 7, resource: zoneTex.createView() },
          { binding: 8, resource: streetView },
        ],
      });
    this.terrainBG = this.buildTerrainBG(streetTex.createView());
    this.waterBG = device.createBindGroup({
      layout: this.water.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: globals } },
        { binding: 1, resource: heightTex.createView() },
        { binding: 2, resource: waterTex.createView() },
      ],
    });

    const quads = (gridSize - 1) * (gridSize - 1);
    const indices = new Uint32Array(quads * 6);
    let cursor = 0;
    for (let j = 0; j < gridSize - 1; j++) {
      for (let i = 0; i < gridSize - 1; i++) {
        const a = j * gridSize + i;
        const b = a + 1;
        const c = a + gridSize;
        const d = c + 1;
        indices[cursor++] = a;
        indices[cursor++] = c;
        indices[cursor++] = b;
        indices[cursor++] = b;
        indices[cursor++] = c;
        indices[cursor++] = d;
      }
    }
    this.indexCount = indices.length;
    this.indexBuffer = device.createBuffer({
      label: "grid-indices",
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, indices);
  }

  /** Swap in the lazily loaded street basemap texture. */
  setStreetTexture(streetTex: GPUTexture): void {
    this.terrainBG = this.buildTerrainBG(streetTex.createView());
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setIndexBuffer(this.indexBuffer, "uint32");
    pass.setPipeline(this.terrain);
    pass.setBindGroup(0, this.terrainBG);
    pass.drawIndexed(this.indexCount);
    pass.setPipeline(this.water);
    pass.setBindGroup(0, this.waterBG);
    pass.drawIndexed(this.indexCount);
  }
}
