# ⬛ ClearMark — Eliminador de marcas de agua

Herramienta 100% open-source para eliminar marcas de agua en imágenes y vídeos
usando **LaMa Inpainting** (IOPaint), FastAPI y Next.js.

---

## Stack

| Capa       | Tecnología                                               |
|------------|----------------------------------------------------------|
| Inpainting | [IOPaint](https://github.com/Sanster/IOPaint) + LaMa     |
| Backend    | Python 3.11 · FastAPI · ffmpeg-python · OpenCV           |
| Frontend   | Next.js 14 · TypeScript · sin dependencias UI externas   |
| Despliegue | Docker Compose (perfiles CPU / GPU)                      |

---

## Inicio rápido

### Sin Docker (desarrollo)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (otra terminal)
cd frontend
npm install
npm run dev
```

Abre http://localhost:3000

### Con Docker — CPU (sin GPU)

```bash
docker compose up --build
```

### Con Docker — GPU NVIDIA

Requiere [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

```bash
docker compose --profile gpu up --build
```

---

## Uso

1. Selecciona **Imagen** o **Vídeo**.
2. Sube el archivo (arrastra o busca).
3. **Imagen:** dibuja un rectángulo sobre la marca de agua en el canvas.
4. **Vídeo:** introduce las coordenadas (x, y, ancho, alto) de la marca.
5. Haz clic en **Eliminar marca de agua** y espera.
6. Descarga el resultado.

---

## API

| Método | Ruta                             | Descripción                         |
|--------|----------------------------------|-------------------------------------|
| POST   | `/remove-watermark-image`        | Imagen → imagen sin marca           |
| POST   | `/remove-watermark-video/start`  | Inicia job de vídeo, devuelve job_id|
| GET    | `/progress/{job_id}`             | SSE con progreso del job            |
| GET    | `/result/{job_id}`               | Descarga el vídeo procesado         |
| GET    | `/health`                        | Estado del servidor + dispositivo   |

---

## Notas

- El modelo **LaMa** se descarga automáticamente en el primer uso (~200 MB).
- Los pesos se cachean en el volumen Docker `model_cache`.
- Para vídeos largos, usa GPU; en CPU puede tardar varios minutos por minuto de vídeo.
- El audio original se preserva en la recodificación.

---

## Licencia

MIT — úsalo, modifícalo, distribúyelo libremente.
