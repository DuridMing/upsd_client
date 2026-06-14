FROM python:3.12-slim

# ── venv & runtime environment ────────────────────────────────────────────────
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/app/venv \
    PATH="/app/venv/bin:$PATH" \
    CONFIG_DIR=/config \
    STATIC_DIR=/static \
    PORT=8080

WORKDIR /app

# Create venv and install dependencies in one layer
COPY app/requirements.txt .
RUN python3 -m venv $VIRTUAL_ENV \
    && pip install --no-cache-dir -r requirements.txt

COPY app/ /app/
COPY static/ /static/

# Download Chart.js if not already bundled by install.sh (non-fatal)
RUN python3 -c "import os,urllib.request as r; p='/static/chart.min.js'; (os.path.isfile(p) and os.path.getsize(p)>100000) or r.urlretrieve('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',p)" || true

EXPOSE ${PORT}

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
