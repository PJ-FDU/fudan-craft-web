"""Render Chinese and English game voices with Qwen3-TTS on Apple Silicon."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import mlx.core as mx
from mlx_audio.tts.utils import load_model
import numpy as np
from scipy.io.wavfile import write as write_wav


MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit"
REVISION = "5c390979e4b93af5f2932f90742ca99c7dd04687"
ROOT = Path(__file__).resolve().parent.parent
CHINESE_CAST = {
    "worker": (
        71, "一位三十多岁的男性工程车操作员。中音偏暖，带一点粗粝感，标准普通话，"
        "亲切随和、口语化，像与熟悉的同事交谈，轻松清晰。",
    ),
    "soldier": (
        175, "一位二十多岁的男性步兵小队长。音色偏明亮，坚实有力，普通话自然，"
        "发音紧凑，干脆直接。战场上只说最必要的字。",
    ),
    "tank": (
        630, "一位四十多岁的男性坦克车长。低中音，声线沉稳稍带沙哑，普通话清楚自然，"
        "节奏稳，字头扎实，像经验丰富的车组长在发令。",
    ),
}
CHINESE_CAST.update({
    "scout": (211, "二十多岁的男性侦察车驾驶员，普通话清楚，中高音，敏捷机警，语气轻快有自信。"),
    "medic": (320, "三十岁左右的女性战地医疗兵，普通话自然，温暖清楚，应变冷静，带一点真实的关切。"),
    "sniper": (452, "三十多岁的男性狙击手，普通话自然，低声、克制，音量小但字清楚，像近距离轻声说话。"),
    "artillery": (801, "四十多岁的男性炮组长，普通话，胸腔共鸣明显，厚实洪亮，发令简洁。"),
    "fighter": (967, "三十岁左右的女性战机飞行员，普通话，音色清亮，口齿干净，通话简练专业。"),
    "mech": (1041, "三十多岁的男性重型机甲驾驶员，普通话，音色宽实低沉，坚定有力，语气自然。"),
    "command": (1280, "三十多岁的女性指挥中心播报员，普通话清晰自然，稳重沉着。保持同一音色。"),
})
CHINESE_DIRECTIONS = {
    "select": "简短报到，语气自然。",
    "move": "自然确认移动指令，紧凑干脆。",
    "attack": "明确回应指令，重音清楚，保持角色自己的声线。",
    "gather": "口语化地确认采集任务。",
    "repair": "平静确认维修任务。",
    "command": "简明播报，保持镇定。",
    "alert": "紧急通知，重音鲜明，保持镇定。",
}
CHINESE_COMMON = "近讲干声，只有人声，清晰自然。无背景音，无音乐，无电台滤波。只说台词。"
ENGLISH_CAST = {
    "worker": (
        71, "An American heavy equipment operator in his thirties. Warm midrange, "
        "slightly weathered, relaxed and practical, talking to coworkers.",
    ),
    "soldier": (
        175, "An American infantry squad leader in his twenties. Bright, firm voice, "
        "crisp and direct, with the economy of someone leading a squad in the field.",
    ),
    "tank": (
        630, "An American tank commander in his forties. Low midrange, slightly gravelly, "
        "measured and confident, speaking to a crew that knows his commands.",
    ),
}
ENGLISH_CAST.update({
    "scout": (211, "A young American scout driver with a higher midrange. Quick, alert, and quietly excited."),
    "medic": (320, "A female American field medic in her thirties. Warm, clear, reassuring, and composed under pressure."),
    "sniper": (452, "An American male sniper in his thirties. Soft low register, reserved and precise, like speaking close to a teammate."),
    "artillery": (801, "An American male gun crew chief in his forties. A chesty, projecting voice with short, practical commands."),
    "fighter": (967, "A female American fighter pilot in her thirties. Clear, bright, concise, and professional."),
    "mech": (1041, "An American male heavy mech pilot in his thirties. Broad, low-mids, steady, and confident."),
    "command": (1280, "An American female operations dispatcher in her thirties. Calm and clear, with a composed, consistent voice."),
})
ENGLISH_DIRECTIONS = {
    "select": "A natural check-in. Brief and confident.",
    "move": "A clipped acknowledgement as the unit gets moving.",
    "attack": "A clear, immediate command response, staying in character.",
    "gather": "Confirm a resource collection order, naturally.",
    "repair": "Confirm a repair order, confidently and without fuss.",
    "command": "A concise operations announcement. Stay composed.",
    "alert": "A clear urgent alert, with steady control.",
}
ENGLISH_COMMON = " Close-mic dry voice. Natural speech. No noise, music, or radio effects. Speak only the line."
LANGUAGES = {
    "zh": ("Chinese", "", CHINESE_CAST, CHINESE_DIRECTIONS, CHINESE_COMMON, "voices", "qwenChineseVoices"),
    "en": ("English", "en-", ENGLISH_CAST, ENGLISH_DIRECTIONS, ENGLISH_COMMON, "englishVoices", "qwenEnglishVoices"),
}
FILTERS = (
    "highpass=f=85,"
    "silenceremove=start_periods=1:start_duration=0.025:start_threshold=-45dB:start_silence=0.02,"
    "areverse,"
    "silenceremove=start_periods=1:start_duration=0.035:start_threshold=-45dB:start_silence=0.06,"
    "areverse,loudnorm=I=-19:TP=-2:LRA=6"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=LANGUAGES, default="zh")
    parser.add_argument("--new-only", action="store_true", help="Keep assets whose current lines were already made with Qwen")
    parser.add_argument("--model", default=MODEL, help="Downloaded MLX model directory or model ID")
    parser.add_argument("--output", type=Path, default=ROOT / "public/assets/audio")
    args = parser.parse_args()
    language, prefix, cast, directions, common, voice_key, metadata_key = LANGUAGES[args.language]
    catalog = subprocess.check_output(
        [
            "node", "--import", "tsx", "--input-type=module", "-e",
            "import {VOICES,EN_VOICES} from './src/game/audio-catalog.ts';"
            "console.log(JSON.stringify(process.argv[1]==='en'?EN_VOICES:VOICES));",
            args.language,
        ],
        cwd=ROOT, text=True,
    )
    translations = json.loads(catalog)
    manifest = args.output / "manifest.json"
    metadata = json.loads(manifest.read_text(encoding="utf-8")) if manifest.is_file() else {}
    existing = set(metadata.get(metadata_key, []))
    previous = metadata.get(voice_key, {})
    voices = [
        (id, text) for id, text in translations.items()
        if not args.new_only or id not in existing or previous.get(id) != text
        or not (args.output / f"{prefix}{id}.mp3").is_file()
    ]
    if voices:
        synthesize(args, voices, language, prefix, cast, directions, common)
    if metadata:
        metadata[voice_key] = translations
        metadata[metadata_key] = list(translations)
        manifest.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def synthesize(args, voices, language, prefix, cast, directions, common):
    model = load_model(args.model, revision=REVISION) if args.model == MODEL else load_model(args.model)
    args.output.mkdir(parents=True, exist_ok=True)
    ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
    with tempfile.TemporaryDirectory(prefix="fudancraft-voice-") as directory:
        staging = Path(directory)
        for id, text in voices:
            name = prefix + id
            if id.startswith("command-"):
                unit = "command"
                action = "alert" if id in ("command-baseAttack", "command-lowPower") else "command"
            else:
                _, unit, action, *_ = id.split("-")
            seed, role = cast[unit]
            instruction = (role + directions[action] + common if args.language == "zh"
                           else f"{role} {directions[action]} {common}")
            mx.random.seed(seed)
            results = list(model.generate_voice_design(
                text=text, language=language, instruct=instruction, temperature=0.75, max_tokens=144,
            ))
            if not results:
                raise RuntimeError(f"No speech generated for {name}")
            audio = np.concatenate([np.asarray(result.audio, dtype=np.float32) for result in results])
            if not np.isfinite(audio).all() or np.max(np.abs(audio), initial=0) < 0.002:
                raise RuntimeError(f"Empty or invalid speech for {name}")
            raw = staging / f"{name}.wav"
            write_wav(raw, results[0].sample_rate, audio)
            rendered = staging / f"{name}.mp3"
            subprocess.run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                    "-af", FILTERS, "-ar", "44100", "-ac", "1", "-codec:a",
                    "libmp3lame", "-b:a", "96k", str(rendered),
                ],
                check=True,
            )
            if rendered.stat().st_size < 2000:
                raise RuntimeError(f"Rendered clip is too short: {name}")
            print(f"{name} {len(audio) / results[0].sample_rate:.2f}s · {text}", flush=True)
        for clip in staging.glob("*.mp3"):
            shutil.copyfile(clip, args.output / clip.name)


if __name__ == "__main__":
    main()
