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

# Create venv and install dependencies in one layer.
# The venv bundles its own (outdated) pip from ensurepip, so upgrade it inside the venv first.
COPY app/requirements.txt .
RUN python3 -m venv $VIRTUAL_ENV \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY app/ /app/
COPY static/ /static/

# Download Chart.js if not already bundled by install.sh (non-fatal)
RUN python3 -c "import os,urllib.request as r; p='/static/chart.min.js'; (os.path.isfile(p) and os.path.getsize(p)>100000) or r.urlretrieve('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',p)" || true

EXPOSE ${PORT}

# 用 exec-form 的 sh -c：JSON 陣列不會被 builder 在「建置時」展開變數，
# 因此 ${PORT} 會原封不動存進映像，改由容器「啟動時」的 shell 解析，
# 才能真正吃到 --env-file / .env 的 PORT。直接寫 shell-form 會被 buildah
# 在建置時用 ENV 預設值 (8080) 展開並烤死，導致 .env 的 PORT 失效。
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
