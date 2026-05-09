# backend/main.py
import asyncio
import json
import os
import shutil
import uuid

import cv2
import ffmpeg
import numpy as np
from fastapi import BackgroundTasks, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image

# iopaint es el sucesor moderno de lama-cleaner (mismo equipo, código abierto)
from iopaint.model_manager import ModelManager
from iopaint.schema import HDStrategy, InpaintRequest

# ---------------------------------------------------------------------------
# App & CORS
# ---------------------------------------------------------------------------
app = FastAPI(title="Watermark Remover API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
UPLOAD_DIR = "uploads"
RESULTS_DIR = "results"
FRAMES_DIR  = "frames"
for d in (UPLOAD_DIR, RESULTS_DIR, FRAMES_DIR):
    os.makedirs(d, exist_ok=True)

# Detectar GPU; usar CPU como fallback
try:
    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
except ImportError:
    DEVICE = "cpu"

print(f"[WatermarkRemover] Cargando modelo LaMa en dispositivo: {DEVICE}")
model_manager = ModelManager(name="lama", device=DEVICE)

# Almacén de progreso por job_id
progress_store: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _inpaint(img_bgr: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Aplica inpainting LaMa sobre la región (x, y, w, h)."""
    h_img, w_img = img_bgr.shape[:2]
    # Clamp coords al tamaño real de la imagen
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(w_img, x + w), min(h_img, y + h)

    mask = np.zeros((h_img, w_img), dtype=np.uint8)
    mask[y1:y2, x1:x2] = 255

    image_pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    mask_pil  = Image.fromarray(mask)

    req = InpaintRequest(
        hd_strategy=HDStrategy.ORIGINAL,
        ldm_steps=20,
        hd_strategy_crop_margin=128,
        hd_strategy_crop_trigger_size=800,
    )
    result = model_manager(image_pil, mask_pil, req)
    return cv2.cvtColor(np.array(result), cv2.COLOR_RGB2BGR)


def _get_video_fps(path: str) -> float:
    """Obtiene FPS real del vídeo con ffprobe."""
    try:
        probe = ffmpeg.probe(path)
        vs = next(s for s in probe["streams"] if s["codec_type"] == "video")
        num, den = map(int, vs.get("r_frame_rate", "24/1").split("/"))
        return num / den if den else 24.0
    except Exception:
        return 24.0


def _has_audio(path: str) -> bool:
    try:
        probe = ffmpeg.probe(path)
        return any(s["codec_type"] == "audio" for s in probe["streams"])
    except Exception:
        return False


def _process_video_sync(job_id: str, in_path: str, x: int, y: int, w: int, h: int):
    """Tarea de fondo: extrae fotogramas → inpainting → recompone con audio."""
    frames_dir = os.path.join(FRAMES_DIR, job_id)
    out_path   = os.path.join(RESULTS_DIR, f"{job_id}_result.mp4")
    os.makedirs(frames_dir, exist_ok=True)

    try:
        # 1. Extraer fotogramas
        progress_store[job_id] = {"status": "extracting", "progress": 0, "total": 0}
        (
            ffmpeg
            .input(in_path)
            .output(os.path.join(frames_dir, "frame_%05d.png"), **{"qscale:v": 2})
            .run(overwrite_output=True, quiet=True)
        )

        fps = _get_video_fps(in_path)
        frame_files = sorted(
            f for f in os.listdir(frames_dir) if f.endswith(".png")
        )
        total = len(frame_files)
        if total == 0:
            raise RuntimeError("No se extrajeron fotogramas del vídeo.")

        # 2. Procesar fotogramas con LaMa
        progress_store[job_id] = {"status": "processing", "progress": 0, "total": total}
        for i, fname in enumerate(frame_files):
            fpath = os.path.join(frames_dir, fname)
            img   = cv2.imread(fpath)
            result = _inpaint(img, x, y, w, h)
            cv2.imwrite(fpath, result)
            progress_store[job_id]["progress"] = i + 1

        # 3. Re-ensamblar vídeo (con o sin pista de audio)
        progress_store[job_id]["status"] = "encoding"
        video_in = ffmpeg.input(
            os.path.join(frames_dir, "frame_%05d.png"), framerate=fps
        )

        if _has_audio(in_path):
            audio_in = ffmpeg.input(in_path).audio
            ffmpeg.output(
                video_in, audio_in, out_path,
                vcodec="libx264", acodec="aac", pix_fmt="yuv420p"
            ).run(overwrite_output=True, quiet=True)
        else:
            ffmpeg.output(
                video_in, out_path,
                vcodec="libx264", pix_fmt="yuv420p"
            ).run(overwrite_output=True, quiet=True)

        progress_store[job_id] = {
            "status": "done",
            "progress": total,
            "total": total,
            "result_path": out_path,
        }

    except Exception as exc:
        progress_store[job_id] = {"status": "error", "message": str(exc)}
    finally:
        # Limpiar fotogramas temporales
        shutil.rmtree(frames_dir, ignore_errors=True)
        # Limpiar upload
        try:
            os.remove(in_path)
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------------------
# Endpoints – Imagen
# ---------------------------------------------------------------------------

@app.post("/remove-watermark-image")
async def remove_watermark_image(
    file:   UploadFile = File(...),
    x:      int = Form(...),
    y:      int = Form(...),
    width:  int = Form(...),
    height: int = Form(...),
):
    job_id    = str(uuid.uuid4())
    img_bytes = await file.read()
    np_arr    = np.frombuffer(img_bytes, np.uint8)
    img       = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    result  = _inpaint(img, x, y, width, height)
    out_path = os.path.join(RESULTS_DIR, f"{job_id}_result.png")
    cv2.imwrite(out_path, result)

    return FileResponse(out_path, media_type="image/png", filename="result.png")


# ---------------------------------------------------------------------------
# Endpoints – Vídeo
# ---------------------------------------------------------------------------

@app.post("/remove-watermark-video/start")
async def start_video_job(
    background_tasks: BackgroundTasks,
    file:   UploadFile = File(...),
    x:      int = Form(...),
    y:      int = Form(...),
    width:  int = Form(...),
    height: int = Form(...),
):
    job_id  = str(uuid.uuid4())
    in_path = os.path.join(UPLOAD_DIR, f"{job_id}_in.mp4")

    with open(in_path, "wb") as f:
        f.write(await file.read())

    progress_store[job_id] = {"status": "queued", "progress": 0, "total": 0}
    background_tasks.add_task(_process_video_sync, job_id, in_path, x, y, width, height)

    return {"job_id": job_id}


@app.get("/progress/{job_id}")
async def stream_progress(job_id: str):
    """Server-Sent Events: emite el progreso del job hasta que termina."""
    async def generator():
        while True:
            info = progress_store.get(job_id, {"status": "pending", "progress": 0})
            yield f"data: {json.dumps(info)}\n\n"
            if info.get("status") in ("done", "error"):
                break
            await asyncio.sleep(0.8)

    return StreamingResponse(generator(), media_type="text/event-stream")


@app.get("/result/{job_id}")
async def get_video_result(job_id: str):
    info = progress_store.get(job_id, {})
    if info.get("status") != "done":
        return {"error": "El resultado aún no está disponible."}
    return FileResponse(info["result_path"], media_type="video/mp4", filename="result.mp4")


@app.get("/health")
async def health():
    return {"status": "ok", "device": DEVICE}
