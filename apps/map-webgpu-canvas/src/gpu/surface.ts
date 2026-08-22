/**
 * Terrain and water surface rendering. Both draw the same (gridSize^2)
 * vertex grid via vertex pulling from the simulation textures, so the water
 * surface always matches the simulated state with zero CPU involvement.
 *
 * Terrain blends three looks: a cartographic "flat map" style, a natural
 * palette, and (when loaded) draped satellite imagery. Fire char/glow,
 * wetness, the scenario susceptibility overlay, and administrative
 * boundaries are applied on top. Server-supplied risk zones are NOT drawn
 * here: they belong to the map's annotation UI, not the terrain surface.
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
@group(0) @binding(7) var streetTex : texture_2d<f32>;
@group(0) @binding(8) var detailTex : texture_2d<f32>;
@group(0) @binding(9) var districtTex : texture_2d<f32>;
@group(0) @binding(10) var fieldTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

/**
 * Bilinear read of the upstream hazard field, in its own grid space. Returns
 * 0 outside the frame's bbox so the field never leaks past where the model
 * actually computed something.
 */
fn hazardField(uv : vec2f) -> f32 {
  let r = G.fieldRect;
  if (r.z <= 0.0 || r.w <= 0.0) { return 0.0; }
  let f = (uv - r.xy) / vec2f(r.z, r.w);
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) { return 0.0; }
  let dim = vec2f(textureDimensions(fieldTex, 0));
  let p = clamp(f, vec2f(0.0), vec2f(1.0)) * (dim - vec2f(1.0));
  let i0 = vec2i(floor(p));
  let t = fract(p);
  let mx = vec2i(i32(dim.x) - 1, i32(dim.y) - 1);
  let a = textureLoad(fieldTex, clamp(i0, vec2i(0), mx), 0).r;
  let b = textureLoad(fieldTex, clamp(i0 + vec2i(1, 0), vec2i(0), mx), 0).r;
  let c = textureLoad(fieldTex, clamp(i0 + vec2i(0, 1), vec2i(0), mx), 0).r;
  let d = textureLoad(fieldTex, clamp(i0 + vec2i(1, 1), vec2i(0), mx), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

/** Bilinear read of the water depth grid. */
fn waterBilinear(uv : vec2f) -> f32 {
  let n = gridN();
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * f32(n - 1);
  let i0 = vec2i(floor(p));
  let f = fract(p);
  let a = textureLoad(waterTex, clampCell(i0), 0).r;
  let b = textureLoad(waterTex, clampCell(i0 + vec2i(1, 0)), 0).r;
  let c = textureLoad(waterTex, clampCell(i0 + vec2i(0, 1)), 0).r;
  let d = textureLoad(waterTex, clampCell(i0 + vec2i(1, 1)), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

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
  // Interpolated by hand: r32float is not filterable without an optional
  // device feature, and point-sampling the depth field draws every simulation
  // cell as a hard square — at this scale, a flat slab hundreds of metres
  // across, which is what the giant blue rectangles were.
  let water = waterBilinear(in.uv);
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

  // The detail patch has to be folded in *before* the tone treatment. Boosting
  // the coarse drape but not the patch left a hard tonal seam along the patch
  // border, with the imagery continuous across it and only the colour jumping.
  let satRaw = textureSample(satTex, satSampler, in.uv).rgb;
  let streetRaw = textureSample(streetTex, satSampler, in.uv).rgb;

  // Sampled unconditionally: textureSample needs uniform control flow to pick
  // a mip level, so the patch is masked after the fact rather than branched
  // around. Clamp-to-edge keeps the out-of-patch fetch harmless.
  let dp = G.detail;
  let duv = (in.uv - dp.xy) / max(dp.z, 1e-6);
  let dcol = textureSample(detailTex, satSampler, clamp(duv, vec2f(0.0), vec2f(1.0)));
  let insidePatch = step(0.0, duv.x) * step(duv.x, 1.0) *
    step(0.0, duv.y) * step(duv.y, 1.0);
  let patchEdge = smoothstep(0.0, 0.12,
    min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y)));
  // Respect alpha so tiles still streaming in leave the coarse basemap
  // visible instead of painting black.
  let patchMask =
    dp.w * insidePatch * patchEdge * dcol.a * step(1e-6, dp.z);

  // Satellite is muted at source, so it gets a saturation lift; the street
  // map is a designed graphic and must not be touched. Both take the patch,
  // because the patch carries whichever style was fetched.
  var sat = mix(satRaw, dcol.rgb, patchMask);
  let satLuma = dot(sat, vec3f(0.299, 0.587, 0.114));
  let satBoost = mix(1.02, 1.28, smoothstep(0.08, 0.30, satLuma));
  sat = clamp(mix(vec3f(satLuma), sat, satBoost) * 1.03, vec3f(0.0), vec3f(1.0));
  let street = mix(streetRaw, dcol.rgb, patchMask);
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

  // Rain is shown by what it does, not by a pattern painted on the ground:
  // the water sim pools it in the valleys under the rainfall footprint and
  // the water surface renders it. All the ground does is go wet and flat.
  let rainAmt = clamp(G.rain.x, 0.0, 1.0);
  if (rainAmt > 0.002) {
    let lum = dot(albedo, vec3f(0.299, 0.587, 0.114));
    albedo = mix(
      albedo,
      mix(albedo, vec3f(lum), 0.34) * vec3f(0.70, 0.76, 0.87),
      rainAmt * 0.55,
    );
  }

  // Hazard-susceptibility zone overlay for the active scenario, drawn as a
  // hatched tint so it reads as an analytical layer over the basemap.
  let risk = landslideRisk(slopeMag, water);
  let riskStatic = textureLoad(riskTex, cell, 0);
  let sc = G.layers.y;
  var zone = 0.0;
  var zoneColor = vec3f(0.0);
  // Each hazard gets its own texture, because one hatch for all of them made
  // every scenario look the same and none of them look urgent.
  //   0 none  1 water contours  2 fire flicker  3 downslope streaks
  //   4 shock rings  5 heat shimmer  6 cold stipple  7 drought crackle
  var pat = 0u;
  let t = G.camPos.w;
  let ws = G.world.x;
  if (sc > 0.5 && sc < 2.5) {
    // Rain / flood: channels and valley floors that collect water.
    zone = smoothstep(0.25, 0.8, riskStatic.r);
    zoneColor = vec3f(0.10, 0.42, 0.98);
    pat = 1u;
  } else if (sc < 3.5) {
    // Wildfire: the densest dry fuel, burning at the edge.
    zone = smoothstep(0.45, 1.0, fire.r * (1.0 - fire.a));
    zoneColor = vec3f(1.0, 0.42, 0.05);
    pat = 2u;
  } else if (sc < 4.5) {
    // Landslide: steep faces, sharpened by live saturation.
    zone = smoothstep(0.3, 0.9, max(risk, riskStatic.g * clamp(G.sim.w * 1.4, 0.0, 1.0)));
    zoneColor = vec3f(0.95, 0.16, 0.09);
    pat = 3u;
  } else if (sc < 5.5) {
    // Typhoon: compound flood exposure.
    zone = smoothstep(0.25, 0.8, riskStatic.r);
    zoneColor = vec3f(0.16, 0.34, 0.95);
    pat = 1u;
  } else if (sc < 6.5) {
    // Earthquake: liquefaction-prone soft lowland soils.
    zone = smoothstep(0.3, 0.8, riskStatic.r) * (1.0 - smoothstep(0.15, 0.4, heightNorm));
    zoneColor = vec3f(0.92, 0.48, 0.14);
    pat = 4u;
  } else if (sc < 7.5) {
    // Tsunami: low-lying coastal strips.
    zone = 1.0 - smoothstep(0.015, 0.07, heightNorm);
    zoneColor = vec3f(0.04, 0.60, 0.84);
    pat = 1u;
  } else if (sc < 9.5) {
    // Nuclear / chemical: the plume itself is the overlay.
    zone = 0.0;
  } else if (sc < 10.5) {
    // Heatwave: flat lowland basins where heat pools.
    zone = (1.0 - riskStatic.g) * (1.0 - smoothstep(0.18, 0.45, heightNorm));
    zoneColor = vec3f(1.0, 0.34, 0.06);
    pat = 5u;
  } else if (sc < 11.5) {
    // Cold wave: exposed highlands.
    zone = smoothstep(0.35, 0.75, heightNorm);
    zoneColor = vec3f(0.34, 0.56, 1.0);
    pat = 6u;
  } else if (sc < 12.5) {
    // Heavy snow: mountain districts at risk of isolation.
    zone = smoothstep(0.32, 0.68, heightNorm);
    zoneColor = vec3f(0.46, 0.58, 0.82);
    pat = 6u;
  } else {
    // Drought: water-supply channels running dry.
    zone = smoothstep(0.25, 0.8, riskStatic.r);
    zoneColor = vec3f(0.86, 0.60, 0.10);
    pat = 7u;
  }

  // World-space coordinates in units that hold their look across a 2 km town
  // view and a 300 km province view.
  let wp = in.worldPos.xz / (ws * 0.004);
  var tex = 1.0;
  if (pat == 1u) {
    // Water: contour bands drifting inward, so the area reads as filling.
    tex = 0.55 + 0.45 * smoothstep(0.35, 0.75, fract(riskStatic.r * 9.0 - t * 0.22));
  } else if (pat == 2u) {
    // Fire: coarse cells flickering out of phase with each other.
    let cell2 = floor(wp * 1.6);
    tex = 0.45 + 0.75 * abs(sin(t * 3.4 + hash2f(vec2i(cell2)) * 31.0));
  } else if (pat == 3u) {
    // Landslide: streaks running down the fall line of the slope itself.
    let down = normalize(vec2f(in.normal.x, in.normal.z) + vec2f(1e-4, 0.0));
    tex = 0.45 + 0.55 * smoothstep(0.3, 0.7, fract(dot(wp, down) * 2.2 + t * 0.5));
  } else if (pat == 4u) {
    // Earthquake: rings expanding from the shaking, then settling.
    tex = 0.5 + 0.5 * smoothstep(0.4, 0.9, fract(length(wp) * 0.7 - t * 0.6));
  } else if (pat == 5u) {
    // Heat: a slow shimmer with no hard edge anywhere in it.
    tex = 0.62 + 0.38 * valueNoise2(wp * 1.3 + vec2f(t * 0.16, -t * 0.11));
  } else if (pat == 6u) {
    // Cold and snow: a still, fine stipple. Weather that does not move.
    tex = 0.55 + 0.45 * step(0.62, valueNoise2(wp * 7.0));
  } else if (pat == 7u) {
    // Drought: a crackle, held still. Ridged noise gives the fracture lines.
    tex = 0.45 + 0.55 * smoothstep(0.55, 0.85, 1.0 - abs(valueNoise2(wp * 3.4) - 0.5) * 2.0);
  }

  // A rim where the field crosses its threshold. Without an edge a hazard
  // area fades into the terrain and reads as a stain rather than a boundary.
  let rim = smoothstep(0.30, 0.52, zone) * (1.0 - smoothstep(0.52, 0.78, zone));
  let live = G.fx.w * zone;
  albedo = mix(albedo, zoneColor, live * 0.5 * tex);
  albedo = mix(albedo, mix(zoneColor, vec3f(1.0), 0.35), G.fx.w * rim * 0.55);

  // Upstream hazard field. Drawn from the model's own grid rather than the
  // local sim, so it resolves at whatever the recipe produced — a stream
  // channel instead of a slab the size of a village.
  let fieldV = hazardField(in.uv);
  let fBlend = G.fieldMeta.x;
  if (fBlend > 0.002 && fieldV > G.fieldMeta.z) {
    let kind = G.fieldMeta.y;
    let peak = max(G.fieldMeta.w, 1e-4);
    // Normalized against a high percentile of the frame, so the tributaries
    // read as well as the trunk. Square-rooted because depth perception is
    // not linear and the shallow end is where the extent actually is.
    let norm = clamp((fieldV - G.fieldMeta.z) / max(peak - G.fieldMeta.z, 1e-4), 0.0, 1.0);
    let ramp = sqrt(norm);
    var fCol = vec3f(0.0);
    if (kind < 0.5) {
      // Inundation: shallow edges pale, the channel through it dark.
      fCol = mix(vec3f(0.30, 0.62, 0.86), vec3f(0.03, 0.16, 0.42), ramp);
    } else if (kind < 1.5) {
      // Fire: the front is bright, the interior burnt.
      fCol = mix(vec3f(0.95, 0.32, 0.06), vec3f(0.996, 0.85, 0.35), ramp);
    } else {
      // Landslide and everything else: a single warning ramp.
      fCol = mix(vec3f(0.92, 0.42, 0.20), vec3f(0.62, 0.06, 0.04), ramp);
    }
    // The long tail of near-threshold cells covers most of a catchment. Left
    // visible it hazes the whole map; cut it and only the channels the water
    // actually runs down are drawn, which is what makes the branching legible.
    let onset = smoothstep(0.0, 0.13, norm);
    albedo = mix(albedo, fCol, fBlend * onset * (0.5 + 0.45 * ramp));
  }

  // Administrative 시/군 boundaries from the national dataset. Independent of
  // the hazard overlay: an operator navigating by district still needs the
  // outlines when the hazard layer is off.
  let districtLine = textureSample(districtTex, satSampler, in.uv);
  albedo = mix(albedo, districtLine.rgb, districtLine.a * G.district.x);

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
  // The street map is a designed graphic: keep it bright and nearly flat,
  // with just a hint of hillshade so 3D relief still reads.
  light = mix(light, 0.92 + diff * 0.14, G.weather.w * satBlend);
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
  // The street map is a designed graphic: bypass the filmic curve so its
  // colors stay crisp instead of washing toward white.
  let toned = tonemap(color);
  let plain = pow(clamp(color, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  return vec4f(mix(toned, plain, G.weather.w * satBlend), 1.0);
}
`;

const WATER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(0) @binding(1) var heightTex : texture_2d<f32>;
@group(0) @binding(2) var waterTex : texture_2d<f32>;
${GRID_WGSL}
${UTIL_WGSL}

/** Ankle depth. Anything shallower is wet ground, not flooding. */
const WATER_MIN_DEPTH : f32 = 0.12;

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
  // Below ankle depth this is wet ground, not inundation. Rendering it filled
  // the whole map with a flat blue wash instead of showing where water
  // actually collects.
  if (w < WATER_MIN_DEPTH) {
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
  if (in.depth < WATER_MIN_DEPTH) { discard; }
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
  // Ramped from the threshold rather than starting at 0.42: an opacity floor
  // is what turned every shallow cell opaque. Now the edge of a flooded
  // channel fades and the deep line through it reads.
  let onset = smoothstep(WATER_MIN_DEPTH, WATER_MIN_DEPTH + 0.35, in.depth);
  let alpha = clamp(onset * (0.30 + 0.62 * depthFactor) + G.world.w * 0.12, 0.0, 0.94);
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
  private buildTerrainBG!: () => GPUBindGroup;
  private streetView!: GPUTextureView;
  private detailView!: GPUTextureView;
  private districtView!: GPUTextureView;
  private fieldView!: GPUTextureView;

  constructor(
    device: GPUDevice,
    globals: GPUBuffer,
    heightTex: GPUTexture,
    waterTex: GPUTexture,
    fireTex: GPUTexture,
    satTex: GPUTexture,
    riskTex: GPUTexture,
    streetTex: GPUTexture,
    fieldTex: GPUTexture,
    detailTex: GPUTexture,
    districtTex: GPUTexture,
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

    // Trilinear plus anisotropy. Without mipmapFilter the mip chain built for
    // these textures would never be used, and without anisotropy the drape
    // smears at the grazing angles the 3D view spends most of its time at.
    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 16,
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.streetView = streetTex.createView();
    this.detailView = detailTex.createView();
    this.districtView = districtTex.createView();
    this.fieldView = fieldTex.createView();
    this.buildTerrainBG = () =>
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
          { binding: 7, resource: this.streetView },
          { binding: 8, resource: this.detailView },
          { binding: 9, resource: this.districtView },
          { binding: 10, resource: this.fieldView },
        ],
      });
    this.terrainBG = this.buildTerrainBG();
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
    this.streetView = streetTex.createView();
    this.terrainBG = this.buildTerrainBG();
  }

  /** Swap in a new upstream hazard-field frame. */
  setFieldTexture(fieldTex: GPUTexture): void {
    this.fieldView = fieldTex.createView();
    this.terrainBG = this.buildTerrainBG();
  }

  /** Swap in a freshly rasterized district-boundary overlay. */
  setDistrictTexture(districtTex: GPUTexture): void {
    this.districtView = districtTex.createView();
    this.terrainBG = this.buildTerrainBG();
  }

  /** Swap in a freshly fetched high-zoom detail patch. */
  setDetailTexture(detailTex: GPUTexture): void {
    this.detailView = detailTex.createView();
    this.terrainBG = this.buildTerrainBG();
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
