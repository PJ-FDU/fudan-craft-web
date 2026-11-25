import {
  ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer, type OrthographicCamera, type Scene,
} from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import type { CinematicBackend, CinematicDisplayOptions } from './cinematic-backend.js';
import { CinematicWebGLDenoiser } from './cinematic-webgl-denoiser.js';

type RuntimeWebGLPathTracer = WebGLPathTracer & {
  stableNoise: boolean;
  readonly isCompiling: boolean;
};

/** WebGL 2 BVH 高清实时＋渐进路径追踪后端：缺少 WebGPU 时自动启用，支持实时追踪与全分辨率 SVGF 降噪。 */
export class WebGLCinematicBackend implements CinematicBackend {
  readonly id = 'webgl2-bvh' as const;
  readonly targetSamples = 128;
  readonly supportsRealtimeDeform = true;
  private renderer?: WebGLRenderer;
  private tracer?: RuntimeWebGLPathTracer;
  private denoiser = new CinematicWebGLDenoiser();
  private disposed = false;
  private realtimeMode = false;
  private lastStepMs = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  async init() {
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error('无法创建 WebGL 2 光追上下文', { cause: error });
    }
    this.renderer = renderer;
    try {
      if (!renderer.capabilities.isWebGL2) {
        throw new Error('当前设备不支持 WebGL 2');
      }
      if (!renderer.extensions.has('EXT_color_buffer_float')) {
        throw new Error('当前设备不支持 WebGL 2 浮点渲染目标 (EXT_color_buffer_float)');
      }
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const tracer = (this.tracer = new WebGLPathTracer(renderer) as RuntimeWebGLPathTracer);
      tracer.bounces = 6;
      tracer.filterGlossyFactor = 0.35;
      tracer.stableNoise = true;
      tracer.multipleImportanceSampling = true;
      tracer.renderDelay = 0;
      tracer.minSamples = 1;
      tracer.fadeDuration = 0;
      tracer.dynamicLowRes = false;
      tracer.rasterizeScene = false;
      tracer.renderToCanvas = false;
      tracer.synchronizeRenderSize = true;
      const textureSpan = Math.min(2048, renderer.capabilities.maxTextureSize);
      tracer.textureSize.set(textureSpan, textureSpan);
      tracer.tiles.set(2, 2);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  get compiling() { return Boolean(this.tracer?.isCompiling); }
  get complete() { return !this.realtimeMode && (this.tracer?.samples ?? 0) >= this.targetSamples; }
  get hasFrame() { return (this.tracer?.samples ?? 0) >= 1; }
  get fullResReady() { return !this.realtimeMode && (this.tracer?.samples ?? 0) >= 1; }
  get isLowRes() { return this.realtimeMode; }
  get samples() { return Math.min(this.targetSamples, this.tracer?.samples ?? 0); }
  get gpuMs() { return this.lastStepMs; }
  get traceWidth() { return this.tracer?.target.width ?? 0; }
  get traceHeight() { return this.tracer?.target.height ?? 0; }

  private applyQualityForSize() {
    if (!this.tracer || !this.renderer) return;
    const physW = this.canvas.width;
    const physH = this.canvas.height;
    const pixels = Math.max(1, physW * physH);
    if (this.realtimeMode) {
      // 实时交互追踪目标 ~24 万像素并单帧完整覆盖，再由全分辨率 SVGF 联合双边与时序重建为 Retina 高清。
      const scale = Math.min(0.65, Math.max(0.35, Math.sqrt(240_000 / pixels)));
      this.tracer.renderScale = scale;
      this.tracer.tiles.set(1, 1);
      this.tracer.bounces = 4;
      this.tracer.stableNoise = false;
    } else {
      this.tracer.renderScale = 1;
      this.tracer.bounces = 6;
      this.tracer.stableNoise = true;
      if (pixels <= 500_000) this.tracer.tiles.set(1, 1);
      else if (pixels <= 1_600_000) this.tracer.tiles.set(2, 2);
      else this.tracer.tiles.set(3, 3);
    }
  }

  setSize(width: number, height: number, pixelRatio: number) {
    if (!this.renderer || this.disposed) return false;
    const physW = Math.floor(width * pixelRatio);
    const physH = Math.floor(height * pixelRatio);
    const resized =
      this.renderer.getPixelRatio() !== pixelRatio ||
      this.canvas.width !== physW ||
      this.canvas.height !== physH;
    if (resized) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.denoiser.resetHistory();
      this.applyQualityForSize();
    }
    return resized;
  }

  setRealtimeMode(realtime: boolean) {
    if (!this.tracer || this.realtimeMode === realtime) return;
    this.realtimeMode = realtime;
    this.applyQualityForSize();
    this.tracer.reset();
  }

  prepareCamera(source: OrthographicCamera, target: OrthographicCamera) {
    target.copy(source);
    target.updateProjectionMatrix();
  }

  setScene(scene: Scene, camera: OrthographicCamera, _transformsOnly: boolean) {
    if (!this.tracer || this.disposed) return;
    this.tracer.setScene(scene, camera);
  }

  updateCamera(camera: OrthographicCamera) {
    if (!this.tracer || this.disposed) return;
    this.tracer.setCamera(camera);
  }

  resetScene() {
    this.denoiser.resetScene();
  }

  resetHistory() {
    this.denoiser.resetHistory();
  }

  renderSample() {
    if (!this.tracer || this.disposed || this.complete) return;
    const start = performance.now();
    this.tracer.renderSample();
    this.lastStepMs = performance.now() - start;
  }

  display(scene: Scene, camera: OrthographicCamera, options: CinematicDisplayOptions) {
    if (!this.renderer || !this.tracer || this.disposed) return;
    const fullW = this.canvas.width;
    const fullH = this.canvas.height;
    if (fullW <= 0 || fullH <= 0) return;
    this.denoiser.render(this.renderer, scene, camera, this.tracer.target.texture, fullW, fullH, options);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.tracer?.dispose();
    this.tracer = undefined;
    this.denoiser.dispose();
    if (this.renderer) {
      try {
        this.renderer.dispose();
        this.renderer.forceContextLoss();
      } catch { /* 忽略已释放上下文。 */ }
      this.renderer = undefined;
    }
  }
}
