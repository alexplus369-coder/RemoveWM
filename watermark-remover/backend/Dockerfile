# backend/Dockerfile
FROM python:3.11-slim

# System deps: ffmpeg + libGL para OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# Instalar PyTorch CPU por defecto; sobreescribir en GPU si se necesita
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

# iopaint descarga el modelo LaMa en primer uso; precargarlo reduce el arranque en prod
RUN python -c "from iopaint.model_manager import ModelManager; ModelManager(name='lama', device='cpu')" || true

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
