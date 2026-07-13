# local_whisper_fast.py — faster-whisper STT(照搬 lumi-OS 作者方案)
# 用法: python local_whisper_fast.py <audio_path>
# 输出: 识别文本到 stdout
# 引擎: faster-whisper + small + int8(CPU,又快又准)

import os, sys, subprocess

MODEL = os.environ.get("OPENCLAW_VOICE_WHISPER_MODEL", "small")  # tiny/base/small/medium/large

def ensure_deps():
    try:
        from faster_whisper import WhisperModel
        return WhisperModel
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "faster-whisper", "-q"])
        from faster_whisper import WhisperModel
        return WhisperModel

def main():
    if len(sys.argv) < 2:
        print("Usage: python local_whisper_fast.py <audio>", file=sys.stderr)
        sys.exit(1)
    audio = sys.argv[1]
    if not os.path.exists(audio):
        print(f"File not found: {audio}", file=sys.stderr)
        sys.exit(1)

    WhisperModel = ensure_deps()
    model_dir = os.environ.get("WHISPER_MODEL_DIR") or os.path.expanduser("~/.openclaw/whisper_models")
    os.makedirs(model_dir, exist_ok=True)

    model = WhisperModel(MODEL, device="cpu", compute_type="int8", download_root=model_dir)
    segments, info = model.transcribe(audio, language="zh", beam_size=5)
    text = "".join(seg.text for seg in segments).strip()
    print(text)

if __name__ == "__main__":
    main()
