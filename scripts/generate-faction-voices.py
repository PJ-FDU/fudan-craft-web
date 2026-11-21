"""Render the four faction voice casts locally with Qwen3-TTS VoiceDesign."""

import argparse
from dataclasses import dataclass
from fnmatch import fnmatchcase
import hashlib
from itertools import batched
import json
import os
from pathlib import Path
import subprocess
import tempfile

import mlx.core as mx
from mlx_audio.tts.utils import load_model
import numpy as np
from scipy.io.wavfile import write as write_wav


ROOT = Path(__file__).resolve().parents[1]
MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit"
REVISION = "5c390979e4b93af5f2932f90742ca99c7dd04687"

# Each role keeps the same performance direction and seed across its dialogue.
CAST = {
    "industrial": {
        "worker": ("三十多岁男工程车驾驶员，中音温厚、略带粗粝，实在随和。",
                   "A male equipment operator in his thirties, warm midrange, a little weathered, practical and easygoing."),
        "soldier": ("二十多岁男步兵班长，偏亮的中音，紧凑爽利，重音扎实。",
                    "A young male squad leader, bright sturdy midrange, clipped and punchy with clear stresses."),
        "scout": ("年轻女侦察员，中高音轻快，警觉，像刚发现近道。",
                  "A young female scout, light upper-mid voice, alert and quick with an easy confidence."),
        "medic": ("三十岁女医疗兵，音色温暖，吐字清楚，应变冷静。",
                  "A female field medic in her thirties, warm and clear, reassuring under pressure."),
        "sniper": ("四十岁男狙击手，低声靠近说话，克制、精确。",
                   "A male sniper in his forties, close low voice, quiet, restrained, and exact."),
        "tank": ("四十岁男坦克车长，低中音略沙哑，语速稳，字头有力。",
                 "A male tank commander in his forties, low midrange with a dry rasp and measured, firm diction."),
        "artillery": ("四十多岁男炮组长，胸腔共鸣强，节拍响亮分明。",
                      "A male artillery crew chief in his forties, strong chest resonance and deliberate projection."),
        "fighter": ("三十岁女飞行员，音色清亮，航空通话简洁专业。",
                    "A female pilot in her thirties, clear and bright, with compact, professional phrasing."),
        "mech": ("四十岁男重型机甲驾驶员，声线低沉宽厚，步调缓而坚定。",
                 "A male heavy mech pilot in his forties, deep and broad with steady, deliberate weight."),
        "commander": ("四十岁女战术指挥官，中音偏低，果断沉着，句尾落稳。",
                      "A female tactical commander in her forties, lower midrange, decisive and composed with firm endings."),
        "disruptor": ("二十多岁男频谱技师，中高音干净，像在口头报告测量。",
                      "A young male spectrum technician, clean upper midrange with precise, economical technical delivery."),
        "command": ("三十多岁女联邦调度员，中音平稳，咬字清楚，训练有素。",
                    "A female Federation dispatcher in her thirties, steady midrange, clear diction and professional composure."),
    },
    "brood": {
        "worker": ("低声的雄性共生体，温厚带气，慢慢连起每个字。",
                   "A low male symbiont voice, warm and breathy, linking the words in a slow deliberate flow."),
        "broodling": ("年轻雄性捕猎者，紧绷偏高的轻沙嗓，短促机警。",
                      "A young male hunter, tight and slightly high with a light rasp, terse and alert."),
        "spitter": ("雌性共生体，烟嗓偏低，吐字利落，发声略带气。",
                    "A female symbiont, smoky low-mid voice, sharply articulated with a trace of breath."),
        "behemoth": ("年长雄性巨兽，宽厚的极低嗓音，慢节奏，威严。",
                     "An older male behemoth, very deep broad bass, slow and imposing with controlled gravel."),
        "bioWing": ("年轻雌性飞掠兽，灵敏偏高，气息轻，语句流畅。",
                    "A young female glider, agile upper-register voice, airy with flowing diction."),
        "sac": ("低沉中性的载囊共生体，声音圆润，有轻微鼻腔共鸣。",
                "An androgynous carrier symbiont, low soft round tone with a hint of nasal resonance."),
        "nurturer": ("成熟雌性育生者，低中音温柔贴耳，关照而沉静。",
                     "A mature female nurturer, intimate low-mid register, gentle and quietly attentive."),
        "infector": ("成年雄性感染者，声音细而沙哑，带一点冷静的好奇。",
                     "An adult male infector, narrow raspy voice with an unsettling, calm curiosity."),
        "binder": ("成年雌性缚地兽，中低音坚实，字与字咬得紧，毫不犹豫。",
                   "An adult female binder, solid low midrange, tightly articulated and unhesitating."),
        "command": ("古老的雌性巢群意志，低沉共鸣，缓慢庄重，字句清楚。",
                    "An ancient female hive intelligence, deep resonant register, measured and grave with clear articulation."),
    },
    "stellar": {
        "worker": ("年轻中性的采集构装，中高音透明，语速平齐，字音精准。",
                   "A youthful androgynous harvester, transparent upper midrange, even pacing and precise vowels."),
        "lancer": ("成年男共鸣卫士，中音明亮，干净果断，像经过训练的仪仗卫士。",
                   "An adult male lance guard, bright focused midrange, clean and decisive like a trained honor guard."),
        "prism": ("成年女棱镜操纵员，干净的中高音，轻柔而准确，停顿齐整。",
                  "An adult female prism operator, clear upper midrange, gentle and exact with neatly timed pauses."),
        "colossus": ("大型构装的男低音，胸腔共鸣平稳，庄严，每个字完整。",
                     "A deep male basso colossus with unwavering resonance, stately pace and fully articulated words."),
        "starWing": ("年轻女辉梭飞行员，清澈偏亮，语速快一点，语气专注。",
                     "A young female light shuttle pilot, lucid bright voice, brisk and intensely focused."),
        "weaver": ("三十岁女护盾织者，柔和的中音，沉着，像在细心校准精密仪器。",
                   "A female shield weaver in her thirties, soft middle register, patient and precise like an instrument maker."),
        "guide": ("二十多岁男导航员，轻而清亮的中高音，简练，方位吐字清楚。",
                  "A male navigator in his twenties, light clear upper midrange, concise and precise about position."),
        "arbiter": ("成熟中性的仲裁构装，低中音清冷，措辞克制，语尾干净。",
                    "A mature androgynous arbiter, cool lower midrange, restrained articulation and clean endings."),
        "command": ("成熟的女议会通讯员，中低音澄澈，节奏平稳，声音庄重而通透。",
                    "A mature female council announcer, crystalline lower midrange, even pace and formal clarity."),
    },
    "relay": {
        "worker": ("四十多岁男车队技师，音色粗中带暖，熟络，很口语化。",
                   "A male convoy mechanic in his forties, rough-warm midrange, familiar and conversational."),
        "ranger": ("二十多岁男巡逻队员，中音坚实，略带年轻的活力，节奏自然。",
                   "A young male patrol ranger, solid middle register with youthful energy and natural timing."),
        "runner": ("二十多岁女轻车驾驶员，中高音敏捷，带笑意，反应快。",
                   "A young female buggy driver, agile upper midrange and a confident hint of a grin."),
        "flak": ("四十岁男护空车长，中低音沙砾感明显，像经验丰富的老车手。",
                 "A male flak truck commander in his forties, gritty low-mid voice like a veteran driver."),
        "relayWing": ("三十岁女巡航飞行员，中音开阔，语气松弛、专业。",
                      "A female patrol pilot in her thirties, open midrange, calm ease and professional clarity."),
        "pathfinder": ("三十多岁男路线工兵，中音沉着平实，像在判断一段路好不好走。",
                       "A male route surveyor in his thirties, steady practical midrange, sounding out the terrain as he speaks."),
        "observer": ("年轻女观察员，轻柔但咬字准确，冷静地说出读数和方向。",
                     "A young female observer, quiet precise diction, cool and unflustered when reading bearings."),
        "escort": ("年长女护航车长，中低音有轻微粗粝感，护着同伴时坚定果断。",
                   "An older female convoy escort, slightly weathered lower midrange, firm and protective of her crew."),
        "assembly": ("五十多岁男架设领班，低沉质朴，动作口令简短清楚。",
                     "A male rig chief in his fifties, earthy low register, giving short, clear work calls."),
        "command": ("四十岁女车队调度，温暖的中低音，语气直接，像在给认识的人说话。",
                    "A female convoy dispatcher in her forties, warm low-mid register, direct and familiar with her crews."),
    },
}
DRY_VOICE = (
    "标准普通话。自然近讲干声，只读台词。",
    "Natural American English. Dry close-miked voice. Speak only the dialogue.",
)
FILTERS = {
    "industrial": "highpass=f=115,lowpass=f=5050,equalizer=f=1400:t=q:w=1:g=1.8",
    "brood": "highpass=f=72,lowpass=f=4650,aecho=0.88:0.92:29|51:0.13|0.06",
    "stellar": "highpass=f=105,aecho=0.9:0.94:27|57:0.12|0.065",
    "relay": "highpass=f=205,lowpass=f=4250,equalizer=f=1250:t=q:w=1:g=2.3",
}
TRIM = (
    "silenceremove=start_periods=1:start_duration=0.022:start_threshold=-48dB:start_silence=0.02,"
    "areverse,"
    "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB:start_silence=0.08,"
    "areverse"
)
LANGUAGES = {"zh": (0, "Chinese", ""), "en": (1, "English", "en-")}
GENERATION = {"temperature": 0.70, "max_tokens": 128}


@dataclass(frozen=True)
class Take:
    text: str
    instruction: str
    seed: int
    filters: str
    destination: Path
    signature: str


def voice_catalog():
    return json.loads(subprocess.check_output(
        ["node", "--import", "tsx", "--input-type=module", "-e",
         "import {FACTION_VOICES} from './src/game/faction-voice.ts';"
         "console.log(JSON.stringify([...FACTION_VOICES]));"],
        cwd=ROOT, text=True,
    ))


def usable(audio, rate):
    return 0.35 <= len(audio) / rate <= 9 and np.isfinite(audio).all() and np.max(np.abs(audio)) >= 0.01


def generate_one(model, language, take):
    for attempt in range(3):
        mx.random.seed(take.seed + attempt)
        packets = list(model.generate_voice_design(
            text=take.text, language=language, instruct=take.instruction, **GENERATION,
        ))
        if packets:
            audio = np.concatenate([np.asarray(packet.audio, dtype=np.float32) for packet in packets])
            rate = packets[0].sample_rate
            if usable(audio, rate):
                return audio, rate
    raise RuntimeError(f"Qwen3-TTS produced no usable take for {take.text!r}")


def generate_group(model, language, group):
    completed = {}
    if len(group) > 1:
        mx.random.seed(group[0].seed)
        try:
            for item in model.batch_generate(
                [take.text for take in group], instructs=[take.instruction for take in group],
                lang_code=language, **GENERATION,
            ):
                audio = np.asarray(item.audio, dtype=np.float32)
                if usable(audio, item.sample_rate):
                    completed[item.sequence_idx] = (audio, item.sample_rate)
        except (ValueError, RuntimeError, TypeError) as error:
            print(f"Batch inference interrupted, retrying remaining lines individually: {error}", flush=True)
            mx.clear_cache()
    for index, take in enumerate(group):
        yield take, completed[index] if index in completed else generate_one(model, language, take)


def encode(audio, rate, take, raw, encoded):
    write_wav(raw, rate, audio)
    subprocess.run(
        [os.getenv("FFMPEG_PATH", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(raw), "-af", f"{TRIM},{take.filters},loudnorm=I=-18:TP=-2:LRA=6",
         "-ar", "44100", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", str(encoded)],
        check=True,
    )
    if encoded.stat().st_size < 3000:
        raise RuntimeError(f"Rendered clip too short: {take.text!r}")


def takes_for(rows, locale, output, model):
    index, _, prefix = LANGUAGES[locale]
    for cue, lines in rows:
        _, race, kind, *rest = cue.split("-")
        role = rest[0] if kind == "unit" else "command"
        seed = int.from_bytes(hashlib.sha256(f"{race}-{role}".encode()).digest()[:3], "big")
        instruction = f"{CAST[race][role][index]} {DRY_VOICE[index]}"
        text, filters = lines[index], FILTERS[race]
        signature = hashlib.sha256(json.dumps(
            [MODEL, REVISION, model, locale, text, instruction, seed, GENERATION, TRIM, filters]
        ).encode()).hexdigest()
        yield Take(text, instruction, seed, filters, output / f"{prefix}{cue}.mp3", signature)


def already_rendered(take, progress):
    entry = progress.get(take.destination.name)
    return (entry and entry["source"] == take.signature and take.destination.is_file()
            and entry["sha256"] == hashlib.sha256(take.destination.read_bytes()).hexdigest())


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--model", default=MODEL, help="Local VoiceDesign snapshot directory or Hugging Face model ID")
    cli.add_argument("--language", choices=("zh", "en", "both"), default="both")
    cli.add_argument("--output", type=Path, default=ROOT / "public/assets/audio/factions-v1/voice-qwen3-v1")
    cli.add_argument("--cue", default="*", help="Optional glob matching faction cue IDs")
    cli.add_argument("--batch-size", type=int, default=6)
    cli.add_argument("--resume", action="store_true", help="Reuse verified Qwen takes from this output directory")
    args = cli.parse_args()
    if args.batch_size < 1:
        cli.error("--batch-size must be positive")
    rows = [(cue, lines) for cue, lines in voice_catalog() if fnmatchcase(cue, args.cue)]
    if not rows:
        cli.error(f"No cue matches {args.cue!r}")
    languages = LANGUAGES if args.language == "both" else [args.language]
    args.output.mkdir(parents=True, exist_ok=True)
    progress_file = args.output / ".qwen-renders.json"
    progress = json.loads(progress_file.read_text(encoding="utf-8")) if progress_file.is_file() else {}
    pending = {locale: [take for take in takes_for(rows, locale, args.output, args.model)
                        if not args.resume or not already_rendered(take, progress)] for locale in languages}
    if not any(pending.values()):
        return
    model = load_model(args.model, revision=REVISION) if args.model == MODEL else load_model(args.model)
    if model.config.tts_model_type != "voice_design":
        raise ValueError("Expected a Qwen3-TTS VoiceDesign model")
    with tempfile.TemporaryDirectory(prefix=".qwen-voice-", dir=args.output) as work:
        raw, encoded, progress_temp = (Path(work) / name for name in ("voice.wav", "voice.mp3", "progress.json"))
        for locale, takes in pending.items():
            language = LANGUAGES[locale][1]
            for group in batched(takes, args.batch_size):
                for take, (audio, rate) in generate_group(model, language, group):
                    encode(audio, rate, take, raw, encoded)
                    progress[take.destination.name] = {
                        "source": take.signature,
                        "sha256": hashlib.sha256(encoded.read_bytes()).hexdigest(),
                    }
                    encoded.replace(take.destination)
                    progress_temp.write_text(json.dumps(progress, indent=2) + "\n", encoding="utf-8")
                    progress_temp.replace(progress_file)
                    print(f"{take.destination.name} {len(audio) / rate:.2f}s · {take.text}", flush=True)


if __name__ == "__main__":
    main()
