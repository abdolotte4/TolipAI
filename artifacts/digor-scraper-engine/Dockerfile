FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libexpat1 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxext6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY requirements.railway.txt .
RUN pip install --no-cache-dir -r requirements.railway.txt

# Pre-download YOLOv8n weights so the first scan doesn't stall waiting for a
# 6 MB internet download at runtime.  The model is cached to ~/.cache/ultralytics
# inside the image layer and reused on every container start.
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" 2>/dev/null || true

COPY workers/ ./workers/
COPY start.sh .
RUN chmod +x start.sh

EXPOSE 8765

CMD ["bash", "start.sh"]
