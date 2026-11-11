r"""
Servidor local de Phonon (TTS) con API compatible con OpenAI: POST /v1/audio/speech.
Devuelve PCM 16-bit, mono, 24 kHz, en streaming (response_format "pcm").

Instalación (Windows x64 con CPU AVX2, Python 3.9+), en un venv local (`.venv-tts`, ignorado por git):
    python -m venv .venv-tts
    .venv-tts\Scripts\python -m pip install ptts fastapi uvicorn
    .venv-tts\Scripts\python scripts/phonon_server.py

Modelo gated (phonon-40m-es): aceptar los términos en su página de Hugging Face y definir HF_TOKEN:
    $env:HF_TOKEN = "hf_..."
    python scripts/phonon_server.py
"""
import os
import threading
from typing import Optional

import numpy as np
import ptts
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel



def _load_dotenv() -> None:
    """Lee `.env` de la raíz del proyecto (p. ej. HF_TOKEN) sin pisar lo que ya esté en el entorno."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                key, sep, value = line.strip().partition("=")
                value = value.strip().strip("\"'")
                if sep and value and not key.startswith("#") and key.strip() not in os.environ:
                    os.environ[key.strip()] = value
    except OSError:
        pass


_load_dotenv()

MODEL = os.environ.get("PTTS_MODEL", "hf://gradium/phonon-40m-es")
LANG = os.environ.get("PTTS_LANG", "es")
QUANT = os.environ.get("PTTS_QUANT", "q8")
HOST = os.environ.get("PTTS_HOST", "127.0.0.1")  # sin autenticación: solo local
PORT = int(os.environ.get("PTTS_PORT", "8880"))
MAX_CHARS = 4096

try:
    tts = ptts.TTS(MODEL, lang=LANG, quant=QUANT)
except OSError as e:
    # Modelo gated sin HF_TOKEN (o sin red). El único modelo público es el de inglés: leería el español con acento inglés,
    # así que solo se usa si se pide expresamente con PTTS_ALLOW_EN_FALLBACK=1.
    print(f"[phonon] No se pudo cargar {MODEL}: {e}", flush=True)
    print("[phonon] Para la voz en español: aceptar los términos del modelo en Hugging Face y definir HF_TOKEN.", flush=True)
    if os.environ.get("PTTS_ALLOW_EN_FALLBACK") != "1":
        raise SystemExit(1)
    print("[phonon] PTTS_ALLOW_EN_FALLBACK=1: se usa el modelo público en inglés (el español suena con acento).", flush=True)
    tts = ptts.TTS(lang=LANG, quant=QUANT)
lock = threading.Lock()  # una generación a la vez; las demás esperan
app = FastAPI()


class SpeechRequest(BaseModel):
    input: str
    voice: Optional[str] = "default"
    model: Optional[str] = None  # ignorado (compatibilidad OpenAI)
    response_format: str = "pcm"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/v1/audio/voices")
def voices():
    return {"voices": list(tts.voices)}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    if req.response_format != "pcm":
        raise HTTPException(400, "solo response_format=pcm (16-bit mono 24 kHz)")
    text = req.input.strip()
    if not text:
        raise HTTPException(400, "input vacío")
    if len(text) > MAX_CHARS:
        raise HTTPException(400, f"input supera {MAX_CHARS} caracteres")
    kwargs = {} if req.voice in (None, "", "default") else {"voice": req.voice}

    def gen():
        with lock:
            with tts.stream(text, **kwargs) as audio:
                for chunk in audio:
                    yield (np.clip(chunk, -1.0, 1.0) * 32767).astype("<i2").tobytes()

    return StreamingResponse(gen(), media_type="audio/L16;rate=24000;channels=1")


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
