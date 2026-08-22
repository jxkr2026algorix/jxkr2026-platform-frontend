/**
 * Mipmap generation for the basemap textures.
 *
 * Without a mip chain the terrain shader has to sample level 0 no matter how
 * far away the surface is, so a 5000-px drape minified to a 1000-px viewport
 * aliases badly — and the aliasing crawls as the camera moves, which reads as
 * the map flickering. WebGPU has no built-in mip generation, so each level is
 * rendered from the one above with a full-screen blit.
 */

const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vid : u32) -> VSOut {
  // Oversized triangle: one primitive covers the target with no index buffer.
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let c = p[vid];
  var out : VSOut;
  out.pos = vec4f(c, 0.0, 1.0);
  out.uv = vec2f((c.x + 1.0) * 0.5, (1.0 - c.y) * 0.5);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  return textureSample(src, samp, in.uv);
}
`;

/** Mip levels a square-ish texture of this size supports. */
export function mipLevelsFor(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export class MipmapGenerator {
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly module: GPUShaderModule;
  private readonly sampler: GPUSampler;

  constructor(private readonly device: GPUDevice) {
    this.module = device.createShaderModule({
      label: "mip-blit",
      code: BLIT_WGSL,
    });
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  private pipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let pipeline = this.pipelines.get(format);
    if (!pipeline) {
      pipeline = this.device.createRenderPipeline({
        label: "mip-blit",
        layout: "auto",
        vertex: { module: this.module, entryPoint: "vs" },
        fragment: {
          module: this.module,
          entryPoint: "fs",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
      this.pipelines.set(format, pipeline);
    }
    return pipeline;
  }

  /** Fill levels 1..n-1 of `texture` from level 0. No-op for a single level. */
  generate(texture: GPUTexture, format: GPUTextureFormat): void {
    if (texture.mipLevelCount <= 1) return;
    const pipeline = this.pipelineFor(format);
    const encoder = this.device.createCommandEncoder({ label: "mipmaps" });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: texture.createView({
              baseMipLevel: level - 1,
              mipLevelCount: 1,
            }),
          },
          { binding: 1, resource: this.sampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
}
