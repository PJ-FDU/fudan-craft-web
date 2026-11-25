import {
  ACESFilmicToneMapping, SRGBColorSpace, type OrthographicCamera, type Scene,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import type { CinematicBackend, CinematicDisplayOptions } from './cinematic-backend.js';
import { CinematicDenoiser } from './cinematic-denoiser.js';

/** WebGPU compute BVH 高清实时＋渐进路径追踪后端。 */
export class WebGPUCinematicBackend implements CinematicBackend {
  readonly id = 'webgpu-bvh' as const;
  readonly targetSamples = 256;
  readonly supportsRealtimeDeform = false;
  private renderer: WebGPURenderer;
  private tracer?: WebGPUPathTracer;
  private denoiser = new CinematicDenoiser();
  private disposed = false;
  private realtimeMode = false;
  private tracedPreviewFrame = false;
  private primedFullRes = false;
  private lastAvg = 0;
  private lastMin = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  async init() {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      throw new Error('当前环境未提供 WebGPU 接口');
    }
    try {
      await this.renderer.init();
      if (this.disposed) {
        this.renderer.dispose();
        return;
      }
      // WebGPURenderer 的 WebGL 后备不能运行 compute 路径追踪。
      const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
      if (!backend.isWebGPUBackend) {
        throw new Error('当前设备没有可用的 WebGPU 计算后端');
      }
      const tracer = (this.tracer = new WebGPUPathTracer(this.renderer));
      tracer.maxBounces = 6;
      tracer.maxSamples = this.targetSamples;
      tracer.filterGlossyFactor = 0.35;
      tracer.clampIndirect = 6;
      tracer.frameBudget = 900000;
      tracer.adaptiveFrameBudget = true;
      tracer.targetFrameTime = 40;
      tracer.dynamicLowRes = false;
      tracer.lowResScale = 0.65;
      tracer.adaptiveDynamicRes = true;
      tracer.minSamples = 1;
      tracer.renderDelay = 0;
      tracer.fadeDuration = 0;
      tracer.asyncCompile = true;
      tracer.stableNoise = true;
      tracer.renderToCanvas = false;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  get compiling() { return Boolean(this.tracer?.compiling); }
  get complete() { return !this.realtimeMode && Boolean(this.tracer?.complete); }
  get hasFrame() { return this.realtimeMode ? this.tracedPreviewFrame : this.primedFullRes; }
  get fullResReady() { return !this.realtimeMode && this.primedFullRes; }
  get isLowRes() { return Boolean(this.tracer?.lowResMode); }
  get samples() { return this.complete ? this.targetSamples : this.lastAvg; }
  get gpuMs() { return this.tracer?.frameTime ?? 0; }
  get traceWidth() { return (this.tracer?.target?.image as { width: number } | undefined)?.width ?? 0; }
  get traceHeight() { return (this.tracer?.target?.image as { height: number } | undefined)?.height ?? 0; }

  setSize(width: number, height: number, pixelRatio: number) {
    const physW = Math.floor(width * pixelRatio);
    const physH = Math.floor(height * pixelRatio);
    const resized =
      this.renderer.getPixelRatio() !== pixelRatio ||
      this.canvas.width !== physW ||
      this.canvas.height !== physH;
    if (resized) {
      this.renderer.setDrawingBufferSize(width, height, pixelRatio);
      this.denoiser.resetHistory();
      this.tracedPreviewFrame = false;
      this.primedFullRes = false;
      this.lastAvg = 0;
      this.lastMin = 0;
    }
    return resized;
  }

  setRealtimeMode(realtime: boolean) {
    if (!this.tracer || this.realtimeMode === realtime) return;
    this.realtimeMode = realtime;
    if (realtime) {
      this.tracer.dynamicLowRes = true;
      this.tracer.adaptiveDynamicRes = true;
      this.tracer.lowResScale = 0.65;
      this.tracer.renderDelay = 400;
      this.tracer.targetFrameTime = 28;
      this.tracer.stableNoise = false;
      this.tracer.maxBounces = 4;
      this.tracedPreviewFrame = false;
      this.primedFullRes = false;
    } else {
      this.tracer.dynamicLowRes = false;
      this.tracer.adaptiveDynamicRes = false;
      this.tracer.renderDelay = 0;
      this.tracer.targetFrameTime = 45;
      this.tracer.stableNoise = true;
      this.tracer.maxBounces = 6;
      this.primedFullRes = false;
      this.lastAvg = 0;
      this.lastMin = 0;
    }
  }

  prepareCamera(source: OrthographicCamera, target: OrthographicCamera) {
    target.copy(source);
    // 两个后端的深度范围不同，避免 WebGPU 修改战场/图鉴原摄像机。
    target.coordinateSystem = this.renderer.coordinateSystem;
    target.updateProjectionMatrix();
  }

  setScene(scene: Scene, camera: OrthographicCamera, transformsOnly: boolean) {
    if (!this.tracer || this.disposed) return;
    if (transformsOnly) {
      this.tracer.updateTransforms();
      this.tracer.updateCamera();
    } else {
      this.tracer.setScene(scene, camera);
    }
    this.tracedPreviewFrame = false;
    this.primedFullRes = false;
    this.lastAvg = 0;
    this.lastMin = 0;
  }

  updateCamera(_camera: OrthographicCamera) {
    if (!this.tracer || this.disposed) return;
    this.tracer.updateCamera();
    this.tracedPreviewFrame = false;
    this.primedFullRes = false;
    this.lastAvg = 0;
    this.lastMin = 0;
  }

  resetScene() {
    this.denoiser.resetScene();
    this.tracedPreviewFrame = false;
    this.primedFullRes = false;
    this.lastAvg = 0;
    this.lastMin = 0;
  }

  resetHistory() {
    this.denoiser.resetHistory();
  }

  renderSample() {
    if (!this.tracer || this.disposed || this.complete) return;
    this.tracer.renderSample();
    if (!this.tracer.compiling && this.tracer.target && this.realtimeMode && this.tracer.lowResMode) {
      this.tracedPreviewFrame = true;
    }
  }

  display(scene: Scene, camera: OrthographicCamera, options: CinematicDisplayOptions) {
    if (!this.tracer?.target || this.disposed) return;
    const fullW = this.canvas.width;
    const fullH = this.canvas.height;
    if (fullW <= 0 || fullH <= 0) return;
    this.denoiser.render(this.renderer, scene, camera, this.tracer.target, fullW, fullH, options);
  }

  async measureSamplesAsync() {
    if (!this.tracer || this.disposed || this.realtimeMode) {
      return { min: this.lastMin, avg: this.lastAvg };
    }
    const counts = await this.tracer.getSampleCountsAsync();
    this.lastMin = counts.min;
    this.lastAvg = counts.avg;
    if (counts.min >= 1) this.primedFullRes = true;
    return { min: counts.min, avg: counts.avg };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.tracer?.dispose();
    this.tracer = undefined;
    this.denoiser.dispose();
    try { this.renderer.dispose(); } catch { /* 初始化失败时后端可能尚未建立。 */ }
  }
}
