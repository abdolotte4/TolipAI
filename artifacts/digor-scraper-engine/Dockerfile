FROM python:3.11-slim

# ─── System dependencies ──────────────────────────────────────────────
# Includes Playwright/Chromium libs, Tesseract OCR, Poppler (for pdf2image),
# and libgomp1 (OpenMP required by PyTorch CPU builds)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates curl \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libxcb1 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxext6 libx11-6 \
    libexpat1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    fonts-liberation xdg-utils libxshmfence1 libx11-xcb1 \
    tesseract-ocr libtesseract-dev \
    poppler-utils \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ─── Python dependencies ──────────────────────────────────────────────
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 prevents crawl4ai's post-install hook
# from downloading a second copy of Chromium during pip install.
# We install the exact browser we want explicitly in the next step.
COPY requirements.railway.txt .
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pip install --no-cache-dir -r requirements.railway.txt \
    && rm -rf /root/.cache/pip

# ─── Playwright Chromium (headless shell) ─────────────────────────────
RUN playwright install --with-deps chromium-headless-shell

# ─── Application code ─────────────────────────────────────────────────
COPY . .

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

CMD ["bash", "start.sh"]
