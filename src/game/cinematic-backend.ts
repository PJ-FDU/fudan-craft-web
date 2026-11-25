import type { OrthographicCamera, Scene } from 'three';

export type CinematicBackendId = 'webgpu-bvh' | 'webgl2-bvh';

export interface CinematicDisplayOptions {
  denoise: boolean;
  temporal: boolean;
  effectiveSamples: number;
  updateHistory: boolean;
}

export interface CinematicBackend {
  readonly id: CinematicBackendId;
  readonly targetSamples: number;
  readonly supportsRealtimeDeform: boolean;
  readonly compiling: boolean;
  readonly complete: boolean;
  readonly hasFrame: boolean;
  readonly fullResReady: boolean;
  readonly isLowRes: boolean;
  readonly samples: number;
  readonly gpuMs: number;
  readonly traceWidth: number;
  readonly traceHeight: number;
  setSize(width: number, height: number, pixelRatio: number): boolean;
  setRealtimeMode(realtime: boolean): void;
  prepareCamera(source: OrthographicCamera, target: OrthographicCamera): void;
  setScene(scene: Scene, camera: OrthographicCamera, transformsOnly: boolean): void;
  updateCamera(camera: OrthographicCamera): void;
  resetScene(): void;
  resetHistory(): void;
  renderSample(): void;
  display(scene: Scene, camera: OrthographicCamera, options: CinematicDisplayOptions): void;
  measureSamplesAsync?(): Promise<{ min: number; avg: number }>;
  dispose(): void;
}
