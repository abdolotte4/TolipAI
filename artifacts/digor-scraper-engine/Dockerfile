FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates curl \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libxcb1 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxext6 libx11-6 \
    libexpat1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    fonts-liberation xdg-utils libxshmfence1 libx11-xcb1 \
    tesseract-ocr libtesseract-dev \   # ← add these
  && rm -rf /var/lib/apt/lists/*


WORKDIR /app

COPY requirements.railway.txt .
RUN pip install --no-cache-dir -r requirements.railway.txt

RUN playwright install chromium --with-deps 2>/dev/null || \
    python -m playwright install chromium 2>/dev/null || true

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

CMD ["bash", "start.sh"]
