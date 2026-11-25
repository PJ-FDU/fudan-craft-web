"""生成并归一化共享 PBR 微底纹与战术贴花库（scripts/material-library/）。

规则：
- 仅作为 Blender Cycles 高低模烘焙输入源，不打包进 public/（零增加网页包体）；
- 所有平铺底纹均做去低频光照均值化与周期无缝混合，杜绝假阴影与接缝，完全适配实时光追。
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--ceramic-src", default="")
parser.add_argument("--ripstop-src", default="")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

OUT = Path(args.out)
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 1024


def save_png(path: Path, rgba: np.ndarray, colorspace: str = "sRGB") -> str:
    h, w = rgba.shape[:2]
    rgba = np.clip(rgba, 0.0, 1.0).astype(np.float32)
    img = bpy.data.images.new(path.name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = colorspace
    # Blender image buffers are bottom-up; flip vertically from standard top-down NumPy arrays.
    img.pixels.foreach_set(np.flipud(rgba).ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_image_rgb(path: Path, size: int = SIZE) -> np.ndarray:
    img = bpy.data.images.load(str(path))
    img.scale(size, size)
    raw = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(raw)
    bpy.data.images.remove(img)
    arr = np.flipud(raw.reshape(size, size, 4))[:, :, :3]
    return np.clip(arr, 0.0, 1.0)


def periodic_blur_fft(arr: np.ndarray, sigma_px: float) -> np.ndarray:
    h, w = arr.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    filt = np.exp(-2.0 * (math.pi ** 2) * (sigma_px ** 2) * (fx * fx + fy * fy))
    if arr.ndim == 2:
        return np.fft.ifft2(np.fft.fft2(arr) * filt).real
    out = np.empty_like(arr)
    for c in range(arr.shape[2]):
        out[:, :, c] = np.fft.ifft2(np.fft.fft2(arr[:, :, c]) * filt).real
    return out


def make_seamless_and_flat(rgb: np.ndarray, highpass_sigma: float = 96.0, blend_frac: float = 0.16) -> np.ndarray:
    """去除低频光照梯度并做半周期滚转平滑融合，输出 100% 无缝平光底纹。"""
    h, w = rgb.shape[:2]
    mean_col = rgb.mean(axis=(0, 1), keepdims=True)
    low = periodic_blur_fft(rgb, highpass_sigma)
    flat = np.clip(rgb - (low - mean_col) * 0.85, 0.0, 1.0)

    # 半周期移位并在交叉接缝处做余弦平滑过渡
    rolled = np.roll(np.roll(flat, h // 2, axis=0), w // 2, axis=1)
    y = np.linspace(-1.0, 1.0, h, endpoint=False)[:, None]
    x = np.linspace(-1.0, 1.0, w, endpoint=False)[None, :]

    def edge_weight(coord):
        d = np.abs(coord)  # 0 at center, 1 at border
        t = np.clip((d - (1.0 - blend_frac * 2.0)) / max(1e-4, blend_frac * 2.0), 0.0, 1.0)
        return 0.5 - 0.5 * np.cos(t * math.pi)

    wy = edge_weight(y)
    wx = edge_weight(x)
    # Border region of `flat` gets replaced smoothly by the interior of `rolled`.
    alpha = np.maximum(wx, wy)[:, :, None]
    seamless = flat * (1.0 - alpha) + rolled * alpha
    # 再做一次极轻低频拉平，确保接缝融合区无亮度漂移
    low2 = periodic_blur_fft(seamless, highpass_sigma * 1.2)
    seamless = np.clip(seamless - (low2 - seamless.mean(axis=(0, 1), keepdims=True)) * 0.65, 0.0, 1.0)
    return seamless


def periodic_fbm(size: int, seed: int, octaves=((4, 0.45), (8, 0.30), (16, 0.15), (32, 0.10)),
                 aniso_x: float = 1.0, aniso_y: float = 1.0) -> np.ndarray:
    """用周期性随机相位频谱合成 100% 周期无缝 fBm（零边缘接缝）。"""
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(size)[:, None] * size / aniso_y
    fx = np.fft.fftfreq(size)[None, :] * size / aniso_x
    r = np.hypot(fx, fy)
    acc = np.zeros((size, size), dtype=np.float64)
    for freq, amp in octaves:
        band = np.exp(-0.5 * ((r - freq) / max(1.0, freq * 0.45)) ** 2)
        band[0, 0] = 0.0
        phase = rng.uniform(0, math.tau, (size, size))
        spec = band * (np.cos(phase) + 1j * np.sin(phase))
        field = np.fft.ifft2(spec).real
        std = field.std()
        if std > 1e-8:
            field /= std
        acc += field * amp
    acc = (acc - acc.mean()) / max(1e-8, acc.std())
    return acc.astype(np.float32)


def build_desert_canvas(size: int = SIZE) -> np.ndarray:
    """2/2 荒漠重型斜纹帆布（无缝平光）。"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    # 128 经纬周期 => 每根纱线约 8px 宽，在 2K 烘焙下清晰可读
    threads = 112.0
    u = xx / size * threads
    v = yy / size * threads

    # 轻微手工织造纱线抖动（周期性）
    wobble_u = periodic_fbm(size, 101, ((6, 0.6), (14, 0.4))) * 0.14
    wobble_v = periodic_fbm(size, 102, ((6, 0.6), (14, 0.4))) * 0.14
    u_j = u + wobble_u
    v_j = v + wobble_v

    # 2/2 斜纹相位：经线浮于 2 根纬线之上、沉于 2 根之下，按对角步进
    iu = np.floor(u_j).astype(np.int32)
    iv = np.floor(v_j).astype(np.int32)
    fu = u_j - iu
    fv = v_j - iv
    twill_phase = (iu + iv) % 4
    warp_top = (twill_phase < 2).astype(np.float32)

    # 纱线圆柱截面微弧与纤维细纹
    warp_arch = np.sin(np.clip(fu, 0.0, 1.0) * math.pi) ** 0.72
    weft_arch = np.sin(np.clip(fv, 0.0, 1.0) * math.pi) ** 0.72
    # 纱线间压扁过渡
    seam_u = np.sin(np.clip(fv, 0.0, 1.0) * math.pi) ** 0.25
    seam_v = np.sin(np.clip(fu, 0.0, 1.0) * math.pi) ** 0.25

    height = warp_top * (0.45 + 0.55 * warp_arch * seam_u) + (1.0 - warp_top) * (0.40 + 0.52 * weft_arch * seam_v)

    # 纤维粗细不均（slub）+ 微尘积聚在织纹凹谷
    slub_u = periodic_fbm(size, 103, ((8, 0.5), (24, 0.5)), aniso_x=0.18, aniso_y=1.0)
    slub_v = periodic_fbm(size, 104, ((8, 0.5), (24, 0.5)), aniso_x=1.0, aniso_y=0.18)
    slub = warp_top * slub_u + (1.0 - warp_top) * slub_v
    dust = periodic_fbm(size, 105, ((4, 0.45), (12, 0.35), (32, 0.20)))
    fine = periodic_fbm(size, 106, ((48, 0.55), (96, 0.45)))

    # 中性荒漠卡其基色（低饱和、平光，进 Blender 后由阵营色板微调）
    base = np.array([0.67, 0.60, 0.47], dtype=np.float32)
    dust_col = np.array([0.75, 0.69, 0.58], dtype=np.float32)
    shade = 0.84 + 0.24 * height + 0.032 * slub + 0.022 * fine
    rgb = base[None, None, :] * shade[:, :, None]
    dust_mask = np.clip((1.0 - height) * 0.55 + dust * 0.14, 0.0, 0.35)[:, :, None]
    rgb = rgb * (1.0 - dust_mask) + dust_col[None, None, :] * dust_mask
    return np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones((size, size, 1), dtype=np.float32)], axis=2)


def build_wool_coat(size: int = SIZE) -> np.ndarray:
    """精纺军装重磅毛呢织纹（无缝平光）。"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    # 更致密的斜纹毛呢（约 160 周期），叠加拉绒短纤维感
    u = xx / size * 156.0
    v = yy / size * 156.0
    diag = np.sin((u + v * 1.0) * math.tau * 0.5) * 0.5 + 0.5
    cross = np.sin((u - v * 0.5) * math.tau) * 0.5 + 0.5
    twill = 0.65 * diag + 0.35 * cross

    brush = periodic_fbm(size, 201, ((16, 0.4), (40, 0.35), (88, 0.25)), aniso_x=0.45, aniso_y=1.0)
    fuzz = periodic_fbm(size, 202, ((10, 0.35), (28, 0.35), (72, 0.30)))
    mottle = periodic_fbm(size, 203, ((4, 0.55), (10, 0.45)))

    # 中性偏灰蓝毛呢基底，保留精细纤维明暗
    base = np.array([0.46, 0.51, 0.57], dtype=np.float32)
    mod = 0.90 + 0.11 * twill + 0.045 * brush + 0.032 * fuzz + 0.022 * mottle
    rgb = base[None, None, :] * mod[:, :, None]
    return np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones((size, size, 1), dtype=np.float32)], axis=2)


def build_brushed_gunmetal(size: int = SIZE) -> np.ndarray:
    """磷化发黑拉丝枪钢微磨损（无缝平光）。"""
    # 强各向异性拉丝条纹 + 细腻氧化斑驳 + 少量干擦微划痕
    streak_h = periodic_fbm(size, 301, ((10, 0.28), (28, 0.34), (72, 0.38)), aniso_x=6.5, aniso_y=0.45)
    streak_f = periodic_fbm(size, 302, ((44, 0.5), (110, 0.5)), aniso_x=4.5, aniso_y=0.35)
    oxide = periodic_fbm(size, 303, ((5, 0.5), (14, 0.32), (34, 0.18)))
    pitting = periodic_fbm(size, 304, ((48, 0.5), (96, 0.5)))

    # 极细的随机周期微划痕
    scratch = np.zeros((size, size), dtype=np.float32)
    rng = np.random.default_rng(305)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    for _ in range(42):
        cx = rng.uniform(0, size)
        cy = rng.uniform(0, size)
        ang = rng.uniform(-0.35, 0.35)
        length = rng.uniform(35, 145)
        dx = ((xx - cx + size * 0.5) % size) - size * 0.5
        dy = ((yy - cy + size * 0.5) % size) - size * 0.5
        along = dx * math.cos(ang) + dy * math.sin(ang)
        perp = -dx * math.sin(ang) + dy * math.cos(ang)
        t = np.clip(1.0 - np.abs(along) / (length * 0.5), 0.0, 1.0)
        line = np.exp(-0.5 * (perp / 0.85) ** 2) * (t ** 0.7)
        scratch = np.maximum(scratch, line * rng.uniform(0.35, 0.85))

    base = np.array([0.48, 0.51, 0.54], dtype=np.float32)
    mod = 0.96 + 0.055 * streak_h + 0.032 * streak_f + 0.045 * oxide + 0.018 * pitting + 0.16 * scratch
    rgb = base[None, None, :] * mod[:, :, None]
    return np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones((size, size, 1), dtype=np.float32)], axis=2)


def build_tactical_radar_screen(size: int = SIZE) -> np.ndarray:
    """高对比平光 2D 科幻战术雷达平板界面（供指挥官与前沿观测员平板显示）。"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = xx / size  # 0..1
    v = yy / size  # 0..1 top->bottom

    rgb = np.zeros((size, size, 3), dtype=np.float32)
    rgb[:, :] = np.array([0.018, 0.068, 0.095], dtype=np.float32)

    cyan = np.array([0.24, 0.92, 0.98], dtype=np.float32)
    teal = np.array([0.08, 0.45, 0.56], dtype=np.float32)
    amber = np.array([0.98, 0.72, 0.24], dtype=np.float32)
    green = np.array([0.36, 0.96, 0.58], dtype=np.float32)

    def add_col(mask, col, strength=1.0):
        nonlocal rgb
        m = np.clip(mask, 0.0, 1.0)[:, :, None] * strength
        rgb = np.clip(rgb + col[None, None, :] * m, 0.0, 1.0)

    # 细战术坐标网格
    gx = np.exp(-((np.abs((u * 12.0 + 0.5) % 1.0 - 0.5)) / 0.018) ** 2)
    gy = np.exp(-((np.abs((v * 12.0 + 0.5) % 1.0 - 0.5)) / 0.018) ** 2)
    add_col(np.maximum(gx, gy), teal, 0.24)

    # 地形等高线（柔和模拟战区地形）
    topo = (np.sin(u * 9.5 + np.cos(v * 7.2) * 1.3) + np.cos(v * 11.0 - u * 4.5) * 0.7) * 2.2
    contour = np.exp(-((np.abs((topo % 1.0) - 0.5)) / 0.032) ** 2)
    in_map = ((u > 0.06) & (u < 0.76) & (v > 0.08) & (v < 0.92)).astype(np.float32)
    add_col(contour * in_map, teal, 0.34)

    # 雷达主圆心 (0.41, 0.50)
    cx, cy = 0.41, 0.50
    dx, dy = u - cx, v - cy
    rad = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)

    # 同心测距圈
    for r0, w0, s0 in ((0.09, 0.0032, 0.75), (0.18, 0.0032, 0.72), (0.27, 0.0035, 0.80), (0.35, 0.0055, 0.95)):
        ring = np.exp(-((rad - r0) / w0) ** 2)
        add_col(ring, cyan, s0)

    # 十字瞄准线与 30° 方位刻度
    cross_h = np.exp(-(np.abs(dy) / 0.0022) ** 2) * (rad < 0.36)
    cross_v = np.exp(-(np.abs(dx) / 0.0022) ** 2) * (rad < 0.36)
    add_col(np.maximum(cross_h, cross_v), cyan, 0.48)

    tick_ang = np.abs(((ang / math.pi * 6.0) + 0.5) % 1.0 - 0.5)
    ticks = np.exp(-(tick_ang / 0.025) ** 2) * ((rad > 0.33) & (rad < 0.37))
    add_col(ticks, cyan, 0.85)

    # 雷达扫描扇形余辉（朝右上 35°）
    sweep_a = -0.62
    da = (sweep_a - ang) % math.tau
    sector = np.exp(-da * 3.8) * (rad < 0.35) * (da < 1.15)
    add_col(sector, cyan, 0.42)
    sweep_beam = np.exp(-(np.abs(da) / 0.018) ** 2) * (rad < 0.35)
    add_col(sweep_beam, cyan, 1.0)

    # 战区目标菱形光点（友方绿、目标琥珀、焦点青）
    for bx, by, col, sz in (
        (0.31, 0.36, amber, 0.018),
        (0.55, 0.32, amber, 0.016),
        (0.50, 0.62, green, 0.016),
        (0.26, 0.58, green, 0.015),
        (0.41, 0.50, cyan, 0.012),
        (0.62, 0.47, amber, 0.014),
    ):
        d_diam = np.abs(u - bx) + np.abs(v - by)
        core = np.clip(1.0 - d_diam / sz, 0.0, 1.0)
        halo = np.exp(-(np.hypot(u - bx, v - by) / (sz * 1.9)) ** 2)
        add_col(core, col, 1.0)
        add_col(halo, col, 0.55)

    # 右侧遥测数据条（0.80..0.94）
    bar_specs = [
        (0.14, 0.78, cyan), (0.20, 0.62, cyan), (0.26, 0.90, green),
        (0.32, 0.48, amber), (0.38, 0.84, cyan), (0.44, 0.72, green),
    ]
    for by, fill, col in bar_specs:
        box_bg = ((u > 0.80) & (u < 0.94) & (v > by) & (v < by + 0.032)).astype(np.float32)
        box_fg = ((u > 0.80) & (u < 0.80 + 0.14 * fill) & (v > by + 0.004) & (v < by + 0.028)).astype(np.float32)
        add_col(box_bg, teal, 0.35)
        add_col(box_fg, col, 0.88)

    # 右下方波形框
    wave_box = ((u > 0.80) & (u < 0.94) & (v > 0.56) & (v < 0.88)).astype(np.float32)
    add_col(wave_box, teal, 0.22)
    wy_line = 0.72 + 0.065 * np.sin(u * 68.0) * np.cos(u * 22.0)
    wave = np.exp(-((v - wy_line) / 0.0045) ** 2) * wave_box
    add_col(wave, cyan, 0.92)

    # 清晰边框与四角战术括号
    border = (
        ((u > 0.03) & (u < 0.97) & ((np.abs(v - 0.04) < 0.005) | (np.abs(v - 0.96) < 0.005))) |
        ((v > 0.04) & (v < 0.96) & ((np.abs(u - 0.03) < 0.005) | (np.abs(u - 0.97) < 0.005)))
    ).astype(np.float32)
    add_col(border, cyan, 0.75)

    return np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones((size, size, 1), dtype=np.float32)], axis=2)


def build_medic_emblem(size: int = 512) -> np.ndarray:
    """工业联邦战地医疗喷涂徽章贴花（透明底，替代凸出红十字积木）。"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (xx / size) * 2.0 - 1.0
    y = (yy / size) * 2.0 - 1.0
    ax, ay = np.abs(x), np.abs(y)

    rgb = np.zeros((size, size, 3), dtype=np.float32)
    alpha = np.zeros((size, size), dtype=np.float32)

    # 八角形深灰工业战术底框
    oct_d = np.maximum(np.maximum(ax, ay), (ax + ay) * 0.7071)
    outer_ring = ((oct_d <= 0.86) & (oct_d >= 0.74)).astype(np.float32)
    # 四边断开卡口形成工业喷码感
    notch = ((ax < 0.14) | (ay < 0.14)).astype(np.float32)
    frame = outer_ring * (1.0 - notch)

    # 清晰斜角红十字（中心略收紧、干脆工业红）
    cross_arm = ((ax <= 0.21) & (ay <= 0.62)) | ((ay <= 0.21) & (ax <= 0.62))
    # 轻微喷涂微磨损颗粒
    wear = periodic_fbm(size, 401, ((16, 0.5), (48, 0.5)))
    scuff = np.clip(1.0 - np.maximum(0.0, wear - 1.15) * 0.45, 0.72, 1.0)

    slate = np.array([0.16, 0.21, 0.25], dtype=np.float32)
    crimson = np.array([0.78, 0.16, 0.13], dtype=np.float32)
    hi_white = np.array([0.92, 0.94, 0.95], dtype=np.float32)

    # 白色内衬细环
    inner_plate = (oct_d < 0.72).astype(np.float32)
    rgb[inner_plate > 0.5] = hi_white
    alpha = np.maximum(alpha, inner_plate * 0.92)

    rgb[frame > 0.5] = slate
    alpha = np.maximum(alpha, frame * 0.96)

    cross_m = cross_arm.astype(np.float32)
    rgb[cross_m > 0.5] = crimson
    alpha = np.maximum(alpha, cross_m * 0.98)

    # 轻微做旧破损
    alpha *= scuff
    return np.concatenate([rgb, np.clip(alpha, 0.0, 1.0)[:, :, None]], axis=2)


def build_hazard_stripe(size: int = 512) -> np.ndarray:
    """工业重型机械 45° 黑黄警示斜纹（无缝平光带微划痕）。"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    u = xx / size
    v = yy / size
    stripe = (((u + v) * 6.0) % 1.0) < 0.50
    wear = periodic_fbm(size, 501, ((8, 0.4), (24, 0.35), (64, 0.25)))
    amber = np.array([0.84, 0.60, 0.14], dtype=np.float32)
    charcoal = np.array([0.11, 0.13, 0.15], dtype=np.float32)
    rgb = np.where(stripe[:, :, None], amber[None, None, :], charcoal[None, None, :])
    rgb = np.clip(rgb * (0.94 + 0.09 * wear[:, :, None]), 0.0, 1.0)
    return np.concatenate([rgb, np.ones((size, size, 1), dtype=np.float32)], axis=2)


manifest = {}

# 1) 工业陶瓷微划痕底纹（优先使用 AI 生图归一化，缺失时程序兜底）
if args.ceramic_src and Path(args.ceramic_src).exists():
    ceramic_rgb = make_seamless_and_flat(load_image_rgb(Path(args.ceramic_src), SIZE), highpass_sigma=84.0)
    ceramic_src_label = "ai-generated + flat-lit seamless normalized"
else:
    n = periodic_fbm(SIZE, 11, ((8, 0.35), (24, 0.35), (64, 0.30)))
    ceramic_rgb = np.clip(0.84 + 0.03 * n, 0.0, 1.0)[:, :, None].repeat(3, axis=2)
    ceramic_src_label = "procedural fallback"
ceramic_rgba = np.concatenate([ceramic_rgb, np.ones((SIZE, SIZE, 1), dtype=np.float32)], axis=2)
manifest["ceramic-armor-grain.png"] = {
    "sha256": save_png(OUT / "ceramic-armor-grain.png", ceramic_rgba),
    "source": ceramic_src_label,
    "size": SIZE,
}

# 2) 防弹尼龙格纹布（优先使用 AI 生图归一化）
if args.ripstop_src and Path(args.ripstop_src).exists():
    rip_rgb = make_seamless_and_flat(load_image_rgb(Path(args.ripstop_src), SIZE), highpass_sigma=72.0)
    rip_src_label = "ai-generated + flat-lit seamless normalized"
else:
    rip_rgb = np.full((SIZE, SIZE, 3), 0.22, dtype=np.float32)
    rip_src_label = "procedural fallback"
rip_rgba = np.concatenate([rip_rgb, np.ones((SIZE, SIZE, 1), dtype=np.float32)], axis=2)
manifest["tactical-nylon-ripstop.png"] = {
    "sha256": save_png(OUT / "tactical-nylon-ripstop.png", rip_rgba),
    "source": rip_src_label,
    "size": SIZE,
}

# 3–7) 数学精确无缝织物/枪钢与高清晰战术贴花
builders = [
    ("desert-canvas-weave.png", build_desert_canvas, SIZE, "synthesized seamless 2/2 heavy twill canvas"),
    ("wool-coat-weave.png", build_wool_coat, SIZE, "synthesized seamless melton officer wool"),
    ("brushed-gunmetal-wear.png", build_brushed_gunmetal, SIZE, "synthesized seamless brushed parkerized steel"),
    ("tactical-radar-screen.png", build_tactical_radar_screen, SIZE, "synthesized orthographic holographic radar UI"),
    ("decal-medic-emblem.png", build_medic_emblem, 512, "synthesized industrial medic stencil decal"),
    ("decal-hazard-stripe.png", build_hazard_stripe, 512, "synthesized industrial hazard stripe decal"),
]
for filename, fn, sz, label in builders:
    rgba = fn(sz)
    manifest[filename] = {
        "sha256": save_png(OUT / filename, rgba),
        "source": label,
        "size": sz,
    }

(OUT / "library.json").write_text(json.dumps(manifest, indent=2) + "\n")
print("MATERIAL_LIBRARY READY:", len(manifest), "textures ->", OUT)
