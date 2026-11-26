import { MAPS, type MapId } from './maps.js';
import { Renderer } from './renderer.js';
import { RESOURCE_STOCK } from './resource-world.js';
import { TILE } from './pathfinding.js';
import { COLORS, type Point, type Side, type ViewState } from './types.js';
import { ELEVATION_LEVELS, WATER_BED_DEPTH, WATER_SURFACE_Y, heightAt } from './terrain-height.js';
import { terrainNoise } from './terrain-shapes.js';
import {
  compileCustomWorld, createBlankMap, createFromBuiltinMap, deleteCustomMap,
  exportCustomMapJSON, importCustomMapJSON, listCustomMaps, MAP_SIZE_PRESETS,
  resizeCustomMap, saveCustomMap, symmetryPoints, validateCustomMap,
  type CustomMapDocument, type SymmetryMode, type ValidationIssue,
} from './custom-maps.js';
import { registerCustomWorld, type Feature, type WorldData } from './world.js';
import { dropdownMarkup,type GameSelect,type Choice } from './dropdown.js';

export type EditorTool =
  | 'elev-1' | 'elev-2' | 'elev-0' | 'ramp' | 'road' | 'water'
  | 'forest' | 'bush' | 'flower' | 'foliage' | 'stump' | 'rock' | 'ruin' | 'erase'
  | 'gold' | 'oil' | 'base-1' | 'base-2' | 'base-3' | 'base-4';

export interface MapEditorCallbacks {
  onExit: () => void;
  onPlaytest: (doc: CustomMapDocument) => void;
  onToast: (message: string, warn?: boolean) => void;
}

const TOOLS: { group: string; items: { id: EditorTool; label: string; hint: string }[] }[] = [
  {
    group: '地形与水体',
    items: [
      { id: 'elev-1', label: '一级高地', hint: '+26' },
      { id: 'elev-2', label: '二级高地', hint: '+52' },
      { id: 'elev-0', label: '平地', hint: '0' },
      { id: 'ramp', label: '斜坡', hint: '通行' },
      { id: 'road', label: '道路', hint: '土路' },
      { id: 'water', label: '水体', hint: '湖泊' },
    ],
  },
  {
    group: '生态与装饰',
    items: [
      { id: 'forest', label: '树林', hint: '可伐' },
      { id: 'bush', label: '灌木', hint: '装饰' },
      { id: 'flower', label: '野花', hint: '点缀' },
      { id: 'foliage', label: '草蕨', hint: '草丛' },
      { id: 'stump', label: '树桩', hint: '林地' },
      { id: 'rock', label: '岩石', hint: '阻挡' },
      { id: 'ruin', label: '遗迹', hint: '石柱' },
      { id: 'erase', label: '橡皮擦', hint: '清除' },
    ],
  },
  {
    group: '资源与出生点',
    items: [
      { id: 'gold', label: '金矿', hint: '10k' },
      { id: 'oil', label: '石油', hint: '3k' },
      { id: 'base-1', label: '1P 基地', hint: '蓝' },
      { id: 'base-2', label: '2P 基地', hint: '红' },
      { id: 'base-3', label: '3P 基地', hint: '绿' },
      { id: 'base-4', label: '4P 基地', hint: '金' },
    ],
  },
];

function cloneDoc(doc: CustomMapDocument): CustomMapDocument {
  return {
    ...doc,
    heights: new Float32Array(doc.heights),
    roads: new Uint8Array(doc.roads),
    water: new Uint8Array(doc.water),
    ramps: new Uint8Array(doc.ramps),
    features: doc.features.map(f => ({ ...f })),
    bases: doc.bases.map(b => ({ ...b })),
    towers: doc.towers.map(t => ({ ...t })),
    deposits: doc.deposits.map(d => ({ ...d })),
  };
}

export class MapEditor {
  private doc: CustomMapDocument;
  private compiled!: WorldData;
  private tool: EditorTool = 'elev-1';
  private radius = 3;
  private symmetry: SymmetryMode = 'rotational';
  private undoStack: CustomMapDocument[] = [];
  private redoStack: CustomMapDocument[] = [];
  private issues: ValidationIssue[] = [];
  private hoverWorld: Point | null = null;
  private painting = false;
  private panning = false;
  private touchPanning = true;
  private panLast: Point = { x: 0, y: 0 };
  private dirtyLandscape = false;
  private lastBrushPoint: Point | null = null;
  private raf = 0;
  private active = true;
  private abort = new AbortController();
  private root: HTMLDivElement;

  constructor(
    private host: HTMLElement,
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private callbacks: MapEditorCallbacks,
    initialDoc?: CustomMapDocument,
  ) {
    this.doc = initialDoc ? cloneDoc(initialDoc) : createBlankMap();
    this.root = document.createElement('div');
    this.root.id = 'map-editor-ui';
    this.root.className = 'map-editor-ui';
    this.host.append(this.root);
    this.renderPanel();
    this.rebuildWorld(true);
    this.renderer.camera.freeOverview = true;
    const center = this.doc.size * TILE / 2;
    this.renderer.camera.focus({ x: center, y: center });
    this.renderer.camera.zoom = .42;
    this.renderer.camera.targetZoom = .42;
    this.bindInput();
    this.loop(performance.now());
  }

  get document(): CustomMapDocument { return this.doc; }

  destroy() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.renderer.camera.freeOverview = false;
    this.renderer.camera.resize(this.renderer.camera.width, this.renderer.camera.height);
    this.root.remove();
  }

  private pushUndo() {
    this.undoStack.push(cloneDoc(this.doc));
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoButtons();
  }

  private undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(cloneDoc(this.doc));
    this.doc = prev;
    this.rebuildWorld(true);
    this.updateUndoButtons();
    this.syncNameInput();
    this.syncSizeSelect();
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneDoc(this.doc));
    this.doc = next;
    this.rebuildWorld(true);
    this.updateUndoButtons();
    this.syncNameInput();
    this.syncSizeSelect();
  }

  private updateUndoButtons() {
    const u = this.root.querySelector<HTMLButtonElement>('#ed-undo');
    const r = this.root.querySelector<HTMLButtonElement>('#ed-redo');
    if (u) u.disabled = this.undoStack.length === 0;
    if (r) r.disabled = this.redoStack.length === 0;
  }

  private syncNameInput() {
    const input = this.root.querySelector<HTMLInputElement>('#ed-name');
    if (input) input.value = this.doc.name;
  }

  private syncSizeSelect() {
    const sel = this.root.querySelector<GameSelect>('#ed-size');
    if (!sel) return;
    const val = String(this.doc.size);
    const choices:Choice[]=MAP_SIZE_PRESETS.map(p=>[String(p.size),p.label]);
    if(!choices.some(([value])=>value===val))choices.push([val,`${this.doc.size}×${this.doc.size} · 自定义`]);
    sel.setOptions(choices,val);
  }

  private rebuildWorld(refreshValidation = true) {
    this.compiled = compileCustomWorld(this.doc);
    registerCustomWorld(this.compiled);
    this.renderer.setCustomWorld(this.compiled);
    if (refreshValidation) {
      this.issues = validateCustomMap(this.doc);
      this.updateValidationBadge();
    }
  }

  private updateValidationBadge() {
    const badge = this.root.querySelector<HTMLButtonElement>('#ed-validate');
    if (!badge) return;
    const errors = this.issues.filter(i => i.severity === 'error');
    const warns = this.issues.filter(i => i.severity === 'warning');
    badge.classList.toggle('has-error', errors.length > 0);
    badge.classList.toggle('has-warn', errors.length === 0 && warns.length > 0);
    if (errors.length) badge.textContent = `✕ ${errors.length} 项错误`;
    else if (warns.length) badge.textContent = `⚠ ${warns.length} 项提示`;
    else badge.textContent = '✓ 地图校验通过';
  }

  private previewView(): ViewState {
    const size = this.doc.size;
    const allVisible = new Uint8Array(size * size).fill(1);
    const allExplored = Array(size * size).fill(1);
    const units = this.doc.bases.map((b, i) => ({
      id: i + 1,
      side: b.side,
      kind: 'base' as const,
      x: b.x,
      y: b.y,
      hp: 2000,
      maxHp: 2000,
      angle: 0,
      construction: 1,
      activity: 'idle' as const,
      order: 'idle' as const,
      path: [],
      velocity: { x: 0, y: 0 },
      cooldown: 0,
      repath: 0,
      target: null,
      builder: null,
      resource: null,
      cargo: 0,
      cargoKind: 'gold' as const,
      returning: false,
    }));
    return {
      oilWells: true,
      mapId: this.doc.id as MapId,
      mapRevision: 1,
      time: 0,
      units,
      nodes: [...(this.compiled.deposits ?? [])],
      players: ([1, 2, 3, 4] as Side[]).map(side => ({
        side,
        name: `P${side}`,
        ai: side > 1,
        team: side,
        race: 'industrial' as const,
        credits: 1500,
        wood: 600,
        oil: 0,
        tech: [],
        queue: [],
        rally: null,
        kills: 0,
        lost: 0,
        harvested: 0,
      })),
      shots: [],
      events: [],
      winner: null,
      explored: allExplored,
      visible: allVisible,
      difficulty: 'normal',
    };
  }

  private applyStroke(worldPoint: Point, singleClick: boolean) {
    const size = this.doc.size, extent = size * TILE, stride = size + 1;
    const points = symmetryPoints(worldPoint, extent, this.symmetry);
    const radPx = this.radius * TILE;

    const flattenHeight = (cx: number, cz: number, targetH: number, rad: number) => {
      const blend = rad + TILE * 1.6;
      const x0 = Math.max(1, Math.floor((cx - blend) / TILE));
      const x1 = Math.min(size - 1, Math.ceil((cx + blend) / TILE));
      const z0 = Math.max(1, Math.floor((cz - blend) / TILE));
      const z1 = Math.min(size - 1, Math.ceil((cz + blend) / TILE));
      for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
        const d = Math.hypot(vx * TILE - cx, vz * TILE - cz);
        if (d > blend) continue;
        const t = d <= rad ? 1 : Math.max(0, 1 - (d - rad) / (blend - rad));
        const w = t * t * (3 - 2 * t);
        const idx = vz * stride + vx;
        this.doc.heights[idx] = this.doc.heights[idx] * (1 - w) + targetH * w;
      }
      // 抬高陆地时同步清除该区水体；下挖到 0 时若原为高地则清除旧斜坡标记
      const tx0 = Math.max(2, Math.floor((cx - rad) / TILE));
      const tx1 = Math.min(size - 3, Math.ceil((cx + rad) / TILE));
      const ty0 = Math.max(2, Math.floor((cz - rad) / TILE));
      const ty1 = Math.min(size - 3, Math.ceil((cz + rad) / TILE));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (Math.hypot((tx + .5) * TILE - cx, (ty + .5) * TILE - cz) > rad) continue;
        const ti = ty * size + tx;
        if (targetH >= 0) this.doc.water[ti] = 0;
        this.doc.ramps[ti] = 0;
      }
    };

    const paintRamp = (cx: number, cz: number, rad: number) => {
      const x0 = Math.max(2, Math.floor((cx - rad) / TILE));
      const x1 = Math.min(size - 2, Math.ceil((cx + rad) / TILE));
      const z0 = Math.max(2, Math.floor((cz - rad) / TILE));
      const z1 = Math.min(size - 2, Math.ceil((cz + rad) / TILE));
      // 3 轮拉普拉斯平滑，在低地与高地间自动生成缓坡，并标记 ramps
      for (let pass = 0; pass < 3; pass++) {
        const snap = new Float32Array(this.doc.heights);
        for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
          if (Math.hypot(vx * TILE - cx, vz * TILE - cz) > rad + TILE) continue;
          const idx = vz * stride + vx;
          if (snap[idx] < -1) continue;
          const avg = (snap[idx - 1] + snap[idx + 1] + snap[idx - stride] + snap[idx + stride] + snap[idx] * 2) / 6;
          this.doc.heights[idx] = Math.max(0, avg);
        }
      }
      for (let ty = Math.max(2, z0 - 1); ty <= Math.min(size - 3, z1); ty++) {
        for (let tx = Math.max(2, x0 - 1); tx <= Math.min(size - 3, x1); tx++) {
          if (Math.hypot((tx + .5) * TILE - cx, (ty + .5) * TILE - cz) > rad + TILE * .5) continue;
          const ti = ty * size + tx;
          if (!this.doc.water[ti]) {
            this.doc.ramps[ti] = 1;
          }
        }
      }
    };

    if (this.tool === 'elev-0' || this.tool === 'elev-1' || this.tool === 'elev-2') {
      const target = this.tool === 'elev-0' ? ELEVATION_LEVELS[0] : this.tool === 'elev-1' ? ELEVATION_LEVELS[1] : ELEVATION_LEVELS[2];
      for (const p of points) flattenHeight(p.x, p.y, target, radPx);
    } else if (this.tool === 'ramp') {
      for (const p of points) paintRamp(p.x, p.y, radPx);
    } else if (this.tool === 'road') {
      for (const p of points) {
        const x0 = Math.max(2, Math.floor((p.x - radPx) / TILE)), x1 = Math.min(size - 3, Math.ceil((p.x + radPx) / TILE));
        const y0 = Math.max(2, Math.floor((p.y - radPx) / TILE)), y1 = Math.min(size - 3, Math.ceil((p.y + radPx) / TILE));
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
          const d = Math.hypot((tx + .5) * TILE - p.x, (ty + .5) * TILE - p.y);
          if (d <= radPx && !this.doc.water[ty * size + tx]) this.doc.roads[ty * size + tx] = 255;
        }
      }
    } else if (this.tool === 'water') {
      const shoreNoise = terrainNoise(917);
      for (const p of points) {
        const bankPad = TILE * 1.45;
        const maxRad = radPx + bankPad;
        const vx0 = Math.max(1, Math.floor((p.x - maxRad - TILE) / TILE)), vx1 = Math.min(size - 1, Math.ceil((p.x + maxRad + TILE) / TILE));
        const vz0 = Math.max(1, Math.floor((p.y - maxRad - TILE) / TILE)), vz1 = Math.min(size - 1, Math.ceil((p.y + maxRad + TILE) / TILE));
        for (let vz = vz0; vz <= vz1; vz++) for (let vx = vx0; vx <= vx1; vx++) {
          const wx = vx * TILE, wz = vz * TILE;
          const d = Math.hypot(wx - p.x, wz - p.y);
          // 叠加柔和噪声扰动与 S 曲线缓坡，形成自然弯曲岸线而非规整方格
          const wobble = 1 + shoreNoise(wx / 145, wz / 145) * .18;
          const outer = maxRad * wobble;
          if (d >= outer) continue;
          const inner = radPx * .32 * wobble;
          const t = Math.max(0, Math.min(1, 1 - (d - inner) / Math.max(1, outer - inner)));
          const smooth = t * t * (3 - 2 * t);
          const depth = WATER_BED_DEPTH * smooth;
          const idx = vz * stride + vx;
          this.doc.heights[idx] = Math.min(this.doc.heights[idx], depth);
        }
        const x0 = Math.max(2, Math.floor((p.x - maxRad) / TILE)), x1 = Math.min(size - 3, Math.ceil((p.x + maxRad) / TILE));
        const y0 = Math.max(2, Math.floor((p.y - maxRad) / TILE)), y1 = Math.min(size - 3, Math.ceil((p.y + maxRad) / TILE));
        const heightSampler = { land: this.doc.water, heights: this.doc.heights };
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
          const h = heightAt(heightSampler, (tx + .5) * TILE, (ty + .5) * TILE);
          if (h < WATER_SURFACE_Y) {
            const ti = ty * size + tx;
            this.doc.water[ti] = 1;
            this.doc.roads[ti] = 0;
            this.doc.ramps[ti] = 0;
          }
        }
        this.doc.features = this.doc.features.filter(f => Math.hypot(f.x - p.x, f.y - p.y) > radPx);
      }
    } else if (
      this.tool === 'forest' || this.tool === 'bush' || this.tool === 'flower'
      || this.tool === 'foliage' || this.tool === 'stump'
      || this.tool === 'rock' || this.tool === 'ruin'
    ) {
      const isDecor = this.tool === 'bush' || this.tool === 'flower' || this.tool === 'foliage' || this.tool === 'stump';
      const spacing = this.tool === 'forest' ? 56
        : this.tool === 'bush' ? 44
        : this.tool === 'flower' || this.tool === 'foliage' ? 32
        : this.tool === 'stump' ? 48
        : this.tool === 'rock' ? 74 : 96;
      const baseClearance = isDecor ? 96 : 180;
      for (const p of points) {
        const count = this.tool === 'forest'
          ? Math.max(1, Math.round(this.radius * 1.1))
          : this.tool === 'flower' || this.tool === 'foliage'
            ? Math.max(2, Math.round(this.radius * 1.6))
            : this.tool === 'bush'
              ? Math.max(1, Math.round(this.radius * .9))
              : 1;
        for (let k = 0; k < count; k++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = count === 1 ? 0 : Math.random() * radPx * .88;
          const fx = Math.max(TILE * 3, Math.min(extent - TILE * 3, p.x + Math.cos(angle) * dist));
          const fy = Math.max(TILE * 3, Math.min(extent - TILE * 3, p.y + Math.sin(angle) * dist));
          const ti = Math.floor(fy / TILE) * size + Math.floor(fx / TILE);
          if (this.doc.water[ti]) continue;
          if (this.doc.features.some(f => Math.hypot(f.x - fx, f.y - fy) < spacing)) continue;
          if (this.doc.bases.some(b => Math.hypot(b.x - fx, b.y - fy) < baseClearance)) continue;
          let feature: Feature;
          if (this.tool === 'forest') {
            const kinds = ['pine', 'oak', 'birch'] as const;
            const kind = kinds[Math.floor(Math.random() * kinds.length)];
            feature = { x: fx, y: fy, kind, size: 92 + Math.random() * 28, cell: kind === 'pine' ? 0 : kind === 'oak' ? 1 : 2, block: false };
          } else if (this.tool === 'bush') {
            feature = { x: fx, y: fy, kind: 'bush', size: 54 + Math.random() * 24, cell: 3, block: false };
          } else if (this.tool === 'flower') {
            feature = { x: fx, y: fy, kind: 'flower', size: 32 + Math.random() * 20, cell: 13, block: false };
          } else if (this.tool === 'foliage') {
            const fern = Math.random() < .5;
            feature = { x: fx, y: fy, kind: fern ? 'fern' : 'grass', size: 30 + Math.random() * 22, cell: fern ? 15 : 12, block: false };
          } else if (this.tool === 'stump') {
            feature = { x: fx, y: fy, kind: 'stump', size: 34 + Math.random() * 14, cell: 14, block: false };
          } else if (this.tool === 'rock') {
            const large = Math.random() < .45;
            feature = { x: fx, y: fy, kind: large ? 'rockLarge' : 'rock', size: large ? 86 + Math.random() * 22 : 52 + Math.random() * 18, cell: large ? 5 : 4, block: true };
          } else {
            feature = { x: fx, y: fy, kind: 'ruin', size: 86, cell: 6, block: true };
          }
          this.doc.features.push(feature);
        }
      }
    } else if (this.tool === 'erase') {
      for (const p of points) {
        const liftBlend = radPx + TILE * 1.4;
        const vx0 = Math.max(1, Math.floor((p.x - liftBlend) / TILE)), vx1 = Math.min(size - 1, Math.ceil((p.x + liftBlend) / TILE));
        const vz0 = Math.max(1, Math.floor((p.y - liftBlend) / TILE)), vz1 = Math.min(size - 1, Math.ceil((p.y + liftBlend) / TILE));
        for (let vz = vz0; vz <= vz1; vz++) for (let vx = vx0; vx <= vx1; vx++) {
          const idx = vz * stride + vx;
          if (this.doc.heights[idx] >= 0) continue;
          const d = Math.hypot(vx * TILE - p.x, vz * TILE - p.y);
          if (d > liftBlend) continue;
          const t = d <= radPx ? 1 : Math.max(0, 1 - (d - radPx) / (liftBlend - radPx));
          const w = t * t * (3 - 2 * t);
          this.doc.heights[idx] = this.doc.heights[idx] * (1 - w);
        }
        const x0 = Math.max(2, Math.floor((p.x - liftBlend) / TILE)), x1 = Math.min(size - 3, Math.ceil((p.x + liftBlend) / TILE));
        const y0 = Math.max(2, Math.floor((p.y - liftBlend) / TILE)), y1 = Math.min(size - 3, Math.ceil((p.y + liftBlend) / TILE));
        const heightSampler = { land: this.doc.water, heights: this.doc.heights };
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
          const d = Math.hypot((tx + .5) * TILE - p.x, (ty + .5) * TILE - p.y);
          const ti = ty * size + tx;
          if (d <= radPx) {
            this.doc.roads[ti] = 0;
            this.doc.ramps[ti] = 0;
            this.doc.water[ti] = 0;
          } else if (this.doc.water[ti] && heightAt(heightSampler, (tx + .5) * TILE, (ty + .5) * TILE) >= WATER_SURFACE_Y) {
            this.doc.water[ti] = 0;
          }
        }
        this.doc.features = this.doc.features.filter(f => Math.hypot(f.x - p.x, f.y - p.y) > radPx);
        this.doc.deposits = this.doc.deposits.filter(d => Math.hypot(d.x - p.x, d.y - p.y) > Math.max(56, radPx));
        this.doc.bases = this.doc.bases.filter(b => Math.hypot(b.x - p.x, b.y - p.y) > Math.max(64, radPx * .8));
      }
    } else if (singleClick && (this.tool === 'gold' || this.tool === 'oil')) {
      for (const p of points) {
        const sx = (Math.floor(p.x / TILE) + .5) * TILE, sy = (Math.floor(p.y / TILE) + .5) * TILE;
        const h = Math.max(0, Math.round(heightAt(this.compiled, sx, sy) / ELEVATION_LEVELS[1]) * ELEVATION_LEVELS[1]);
        flattenHeight(sx, sy, h, 96);
        this.doc.deposits = this.doc.deposits.filter(d => Math.hypot(d.x - sx, d.y - sy) > 84);
        this.doc.features = this.doc.features.filter(f => Math.hypot(f.x - sx, f.y - sy) > 90);
        this.doc.deposits.push({
          x: sx,
          y: sy,
          kind: this.tool,
          amount: this.tool === 'gold' ? RESOURCE_STOCK.mainGold : RESOURCE_STOCK.mainOil,
        });
      }
    } else if (singleClick && this.tool.startsWith('base-')) {
      const side = Number(this.tool.slice(5)) as Side;
      const sx = (Math.floor(worldPoint.x / TILE) + .5) * TILE, sy = (Math.floor(worldPoint.y / TILE) + .5) * TILE;
      const h = Math.max(0, Math.round(heightAt(this.compiled, sx, sy) / ELEVATION_LEVELS[1]) * ELEVATION_LEVELS[1]);
      flattenHeight(sx, sy, h, 240);
      this.doc.features = this.doc.features.filter(f => Math.hypot(f.x - sx, f.y - sy) > 220);
      this.doc.bases = this.doc.bases.filter(b => b.side !== side);
      this.doc.bases.push({ x: sx, y: sy, side });
      this.doc.bases.sort((a, b) => a.side - b.side);
      this.doc.maxPlayers = Math.max(2, Math.min(4, this.doc.bases.length));
    }

    this.dirtyLandscape = true;
  }

  private bindInput() {
    const signal = this.abort.signal;
    let activePointer:number|null=null;
    const screenPoint = (e: MouseEvent | PointerEvent): Point => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    this.canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
    this.canvas.addEventListener('pointerdown', e => {
      // 第二根手指不能再开一笔绘制，也不能提前结束第一根手指的笔画。
      if(activePointer!==null)return;
      if (e.button === 1 || e.button === 2 || e.pointerType==='touch'&&this.touchPanning) {
        activePointer=e.pointerId;
        this.panning = true;
        this.panLast = { x: e.clientX, y: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      activePointer=e.pointerId;
      this.pushUndo();
      this.painting = true;
      const w = this.renderer.screenToWorld(screenPoint(e));
      this.hoverWorld = w;
      this.lastBrushPoint = w;
      this.applyStroke(w, true);
      this.rebuildWorld(false);
      this.dirtyLandscape = false;
      this.canvas.setPointerCapture(e.pointerId);
    }, { signal });
    this.canvas.addEventListener('pointermove', e => {
      if(activePointer!==null&&activePointer!==e.pointerId)return;
      if (this.panning) {
        this.renderer.pan(this.panLast.x - e.clientX, this.panLast.y - e.clientY);
        this.panLast = { x: e.clientX, y: e.clientY };
        return;
      }
      const w = this.renderer.screenToWorld(screenPoint(e));
      this.hoverWorld = w;
      this.updateCursorReadout(w);
      if (!this.painting) return;
      if (this.tool === 'gold' || this.tool === 'oil' || this.tool.startsWith('base-')) return;
      if (this.lastBrushPoint && Math.hypot(w.x - this.lastBrushPoint.x, w.y - this.lastBrushPoint.y) < TILE * .45) return;
      this.lastBrushPoint = w;
      this.applyStroke(w, false);
    }, { signal });
    const stopPointer = (e:PointerEvent) => {
      if(activePointer!==e.pointerId)return;
      activePointer=null;
      if (this.painting) {
        this.painting = false;
        this.lastBrushPoint = null;
        this.rebuildWorld(true);
        this.dirtyLandscape = false;
      }
      this.panning = false;
    };
    this.canvas.addEventListener('pointerup', stopPointer, { signal });
    this.canvas.addEventListener('pointercancel', stopPointer, { signal });
    this.canvas.addEventListener('lostpointercapture', stopPointer, { signal });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.renderer.zoomAt(factor, screenPoint(e));
    }, { passive: false, signal });
    window.addEventListener('keydown', e => {
      if(e.defaultPrevented||(e.target as HTMLElement)?.closest('input,textarea,game-select,[contenteditable]'))return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (e.key.toLowerCase() === 'z') this.renderer.orbit(-1);
      else if (e.key.toLowerCase() === 'c') this.renderer.orbit(1);
      else if (e.key === '[') { this.radius = Math.max(1, this.radius - 1); this.syncBrushSlider(); }
      else if (e.key === ']') { this.radius = Math.min(8, this.radius + 1); this.syncBrushSlider(); }
    }, { signal });
  }

  private syncBrushSlider() {
    const slider = this.root.querySelector<HTMLInputElement>('#ed-radius');
    const out = this.root.querySelector<HTMLElement>('#ed-radius-val');
    if (slider) slider.value = String(this.radius);
    if (out) out.textContent = `${this.radius} 格`;
  }

  private updateCursorReadout(w: Point) {
    const el = this.root.querySelector<HTMLElement>('#ed-coords');
    if (!el) return;
    const h = heightAt(this.compiled, w.x, w.y);
    el.textContent = `X ${Math.floor(w.x / TILE)} · Z ${Math.floor(w.y / TILE)} · 海拔 ${h.toFixed(0)}`;
  }

  private drawOverlay() {
    const c = this.canvas.getContext('2d');
    if (!c || !this.hoverWorld) return;
    const extent = this.doc.size * TILE;
    const isSingle = this.tool === 'gold' || this.tool === 'oil' || this.tool.startsWith('base-');
    const pts = isSingle && this.tool.startsWith('base-')
      ? [this.hoverWorld]
      : symmetryPoints(this.hoverWorld, extent, this.symmetry);
    const radPx = isSingle ? 44 : this.radius * TILE;
    c.save();
    for (let idx = 0; idx < pts.length; idx++) {
      const center = pts[idx];
      c.strokeStyle = idx === 0 ? '#e8d79e' : '#8fd6c4a8';
      c.lineWidth = idx === 0 ? 2 : 1.3;
      c.beginPath();
      for (let i = 0; i <= 36; i++) {
        const a = i / 36 * Math.PI * 2;
        const px = center.x + Math.cos(a) * radPx, pz = center.y + Math.sin(a) * radPx;
        const s = this.renderer.camera.worldToScreen({ x: px, y: pz }, heightAt(this.compiled, px, pz) + 1);
        if (i === 0) c.moveTo(s.x, s.y); else c.lineTo(s.x, s.y);
      }
      c.stroke();
    }
    // 标注基地阵营颜色标签
    for (const b of this.doc.bases) {
      const s = this.renderer.camera.worldToScreen(b, heightAt(this.compiled, b.x, b.y) + 60);
      c.fillStyle = '#0d1a16d8';
      c.fillRect(s.x - 24, s.y - 12, 48, 20);
      c.strokeStyle = COLORS[b.side];
      c.lineWidth = 1.5;
      c.strokeRect(s.x - 24, s.y - 12, 48, 20);
      c.fillStyle = '#edf3e5';
      c.font = 'bold 11px monospace';
      c.textAlign = 'center';
      c.fillText(`P${b.side} 基地`, s.x, s.y + 2);
    }
    c.restore();
  }

  private loop = (now: number) => {
    if (!this.active) return;
    if (this.dirtyLandscape) {
      this.rebuildWorld(false);
      this.dirtyLandscape = false;
    }
    this.renderer.draw(this.previewView(), now);
    this.drawOverlay();
    this.raf = requestAnimationFrame(this.loop);
  };

  private renderPanel() {
    this.root.innerHTML = `
      <header class="ed-topbar">
        <div class="ed-brand"><strong>3D 地图编辑器</strong><input id="ed-name" type="text" maxlength="32" value="${this.doc.name}" aria-label="地图名称"/></div>
        <div class="ed-actions">
          ${dropdownMarkup('ed-size','地图尺寸规格',MAP_SIZE_PRESETS.map(p=>[String(p.size),p.label]),String(this.doc.size))}
          ${dropdownMarkup('ed-template','载入模板或已保存地图',this.templateChoices())}
          <button id="ed-undo" type="button" disabled title="撤销 (Ctrl+Z)">撤销</button>
          <button id="ed-redo" type="button" disabled title="重做 (Ctrl+Shift+Z)">重做</button>
          <button id="ed-validate" type="button" class="ed-badge">✓ 地图校验通过</button>
          <button id="ed-save" type="button">保存</button>
          <button id="ed-export" type="button">导出 JSON</button>
          <button id="ed-import" type="button">导入 JSON</button>
          <input id="ed-import-file" type="file" accept=".json,application/json" hidden/>
          <button id="ed-play" type="button" class="ed-primary">立即试玩 ▶</button>
          <button id="ed-zoom-in" class="ed-touch-control" type="button" aria-label="放大地图">＋</button>
          <button id="ed-zoom-out" class="ed-touch-control" type="button" aria-label="缩小地图">−</button>
        </div>
        <div class="ed-primary-actions"><button id="ed-pan" class="ed-touch-control" type="button" aria-pressed="true">移图</button><button id="ed-tools-toggle" class="ed-touch-control" type="button" aria-expanded="false" aria-controls="ed-sidebar">工具</button><button id="ed-exit" type="button">退出</button></div>
      </header>
      <aside id="ed-sidebar" class="ed-sidebar" aria-label="地图编辑工具箱">
        ${TOOLS.map(group => `
          <section class="ed-group">
            <h3>${group.group}</h3>
            <div class="ed-tools">
              ${group.items.map(t => `<button type="button" class="ed-tool${t.id === this.tool ? ' active' : ''}" data-tool="${t.id}"><span>${t.label}</span><small>${t.hint}</small></button>`).join('')}
            </div>
          </section>
        `).join('')}
        <section class="ed-group">
          <h3>笔刷与对称</h3>
          <label class="ed-field"><span>笔刷半径 <b id="ed-radius-val">${this.radius} 格</b></span><input id="ed-radius" type="range" min="1" max="8" value="${this.radius}"/></label>
          <label class="ed-field"><span>对称模式</span>
            ${dropdownMarkup('ed-symmetry','对称模式',[['none','无对称'],['horizontal','水平镜像 (左右)'],['vertical','垂直镜像 (上下)'],['rotational','中心旋转 (1v1 推荐)'],['quad','四角对称 (4P 推荐)']],this.symmetry)}
          </label>
          <div class="ed-camera-row">
            <button id="ed-orbit-l" type="button">↶ 旋转</button>
            <button id="ed-orbit-r" type="button">↷ 旋转</button>
            <button id="ed-delete-saved" type="button" title="删除当前已保存的自定义地图">删档</button>
          </div>
        </section>
        <footer class="ed-footer">
          <div id="ed-coords">X 64 · Z 64 · 海拔 0</div>
          <small>左键绘制 · 右键拖动平移 · 滚轮缩放 · Z/C 旋转 · [ ] 调笔刷</small>
          <small class="ed-touch-control">「移图」拖动画面；选择笔刷后单指绘制，＋ / − 缩放。</small>
        </footer>
      </aside>
    `;

    const toggle=this.root.querySelector<HTMLButtonElement>('#ed-tools-toggle')!;
    toggle.onclick=()=>{
      const open=this.root.classList.toggle('ed-tools-open');
      toggle.setAttribute('aria-expanded',String(open));
    };
    const pan=this.root.querySelector<HTMLButtonElement>('#ed-pan')!;
    pan.onclick=()=>{this.touchPanning=!this.touchPanning;pan.setAttribute('aria-pressed',String(this.touchPanning));};
    for(const [id,factor] of [['ed-zoom-in',1.2],['ed-zoom-out',1/1.2]] as const){
      this.root.querySelector<HTMLButtonElement>('#'+id)!.onclick=()=>this.renderer.zoomAt(factor,{x:this.renderer.width/2,y:this.renderer.height/2});
    }
    this.root.querySelector<HTMLInputElement>('#ed-name')!.oninput = e => {
      this.doc.name = (e.target as HTMLInputElement).value;
    };
    this.syncSizeSelect();
    this.root.querySelector<GameSelect>('#ed-size')!.onchange = e => {
      const targetSize = Number((e.target as GameSelect).value);
      if (!Number.isInteger(targetSize) || targetSize === this.doc.size) return;
      this.pushUndo();
      const { doc, worldOffset, trimmedCount, clampedBases } = resizeCustomMap(this.doc, targetSize);
      this.doc = doc;
      this.rebuildWorld(true);
      this.syncSizeSelect();
      const extent = this.doc.size * TILE;
      this.renderer.camera.focus({
        x: Math.max(TILE * 2, Math.min(extent - TILE * 2, this.renderer.camera.x + worldOffset)),
        y: Math.max(TILE * 2, Math.min(extent - TILE * 2, this.renderer.camera.y + worldOffset)),
      });
      const notes: string[] = [];
      if (trimmedCount > 0) notes.push(`裁切了 ${trimmedCount} 个边界外物件`);
      if (clampedBases > 0) notes.push(`${clampedBases} 个基地已自动移入边界内`);
      this.callbacks.onToast(`地图规格已调整为 ${targetSize}×${targetSize}${notes.length ? `（${notes.join('，')}）` : ''}`);
    };
    this.root.querySelectorAll<HTMLButtonElement>('.ed-tool').forEach(btn => {
      btn.onclick = () => {
        this.tool = btn.dataset.tool as EditorTool;
        this.root.querySelectorAll('.ed-tool').forEach(b => b.classList.toggle('active', b === btn));
        this.touchPanning=false;pan.setAttribute('aria-pressed','false');
        if(matchMedia('(max-width:800px), (pointer:coarse)').matches){
          this.root.classList.remove('ed-tools-open');toggle.setAttribute('aria-expanded','false');
        }
      };
    });
    this.root.querySelector<HTMLInputElement>('#ed-radius')!.oninput = e => {
      this.radius = Number((e.target as HTMLInputElement).value);
      this.syncBrushSlider();
    };
    this.root.querySelector<GameSelect>('#ed-symmetry')!.onchange = e => {
      this.symmetry = (e.target as GameSelect).value as SymmetryMode;
    };
    this.root.querySelector<HTMLButtonElement>('#ed-undo')!.onclick = () => this.undo();
    this.root.querySelector<HTMLButtonElement>('#ed-redo')!.onclick = () => this.redo();
    this.root.querySelector<HTMLButtonElement>('#ed-orbit-l')!.onclick = () => this.renderer.orbit(-1);
    this.root.querySelector<HTMLButtonElement>('#ed-orbit-r')!.onclick = () => this.renderer.orbit(1);
    this.root.querySelector<HTMLButtonElement>('#ed-validate')!.onclick = () => {
      this.issues = validateCustomMap(this.doc);
      this.updateValidationBadge();
      if (!this.issues.length) {
        this.callbacks.onToast('地图校验通过：基地连通、矿区与高地斜坡均正常');
        return;
      }
      const first = this.issues[0];
      if (first.point) this.renderer.camera.focus(first.point);
      this.callbacks.onToast(first.message, first.severity === 'error');
    };
    this.root.querySelector<HTMLButtonElement>('#ed-save')!.onclick = () => {
      saveCustomMap(this.doc);
      this.callbacks.onToast(`已保存自定义地图「${this.doc.name || '自定义战场'}」`);
      this.refreshTemplateSelect();
    };
    this.root.querySelector<HTMLButtonElement>('#ed-delete-saved')!.onclick = () => {
      deleteCustomMap(this.doc.id);
      this.callbacks.onToast('已从本地列表移除当前自定义地图');
      this.refreshTemplateSelect();
    };
    this.root.querySelector<HTMLButtonElement>('#ed-export')!.onclick = () => {
      const json = exportCustomMapJSON(this.doc);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(this.doc.name || 'custom-map').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.fudancraft.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.callbacks.onToast('已导出自定义地图 JSON');
    };
    const fileInput = this.root.querySelector<HTMLInputElement>('#ed-import-file')!;
    this.root.querySelector<HTMLButtonElement>('#ed-import')!.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const imported = importCustomMapJSON(await file.text());
        this.pushUndo();
        this.doc = imported;
        this.rebuildWorld(true);
        this.syncNameInput();
        this.syncSizeSelect();
        this.callbacks.onToast(`已导入自定义地图「${imported.name}」`);
      } catch (err) {
        this.callbacks.onToast((err as Error).message || '导入失败：无效的地图 JSON', true);
      }
    };
    this.root.querySelector<GameSelect>('#ed-template')!.onchange = e => {
      const val = (e.target as GameSelect).value;
      (e.target as GameSelect).value = '';
      if (!val) return;
      this.pushUndo();
      if (val === '__blank__') this.doc = createBlankMap(undefined, this.doc.size);
      else if (val.startsWith('builtin:')) this.doc = createFromBuiltinMap(val.slice(8) as MapId);
      else if (val.startsWith('saved:')) {
        const found = listCustomMaps().find(m => m.id === val.slice(6));
        if (found) this.doc = found;
      }
      this.rebuildWorld(true);
      this.syncNameInput();
      this.syncSizeSelect();
      const center = this.doc.size * TILE / 2;
      this.renderer.camera.focus({ x: center, y: center });
    };
    this.root.querySelector<HTMLButtonElement>('#ed-play')!.onclick = () => {
      this.issues = validateCustomMap(this.doc);
      this.updateValidationBadge();
      const err = this.issues.find(i => i.severity === 'error');
      if (err) {
        if (err.point) this.renderer.camera.focus(err.point);
        this.callbacks.onToast(`无法试玩：${err.message}`, true);
        return;
      }
      saveCustomMap(this.doc);
      this.callbacks.onPlaytest(cloneDoc(this.doc));
    };
    this.root.querySelector<HTMLButtonElement>('#ed-exit')!.onclick = () => this.callbacks.onExit();
  }

  private templateChoices():Choice[]{
    return [['','模板 / 已保存地图…'],['__blank__','+ 新建空白地图'],
      ...MAPS.map(m=>[`builtin:${m.id}`,`内置 · ${m.name}`] as Choice),
      ...listCustomMaps().map(m=>[`saved:${m.id}`,`已保存 · ${m.name}`] as Choice)];
  }
  private refreshTemplateSelect() {
    const sel = this.root.querySelector<GameSelect>('#ed-template');
    sel?.setOptions(this.templateChoices(),sel.value);
  }
}
