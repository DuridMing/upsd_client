#!/bin/bash
# UPS Monitor — 安裝與管理腳本
# 使用方式：./install.sh [install|start|stop|restart|update|status|logs|run-local|venv]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 顏色 ──────────────────────────────────────────────────────────────────────
B='\033[1m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; D='\033[2m'; N='\033[0m'

CONTAINER="ups-monitor"
IMAGE="ups-monitor"
ENV_FILE="${SCRIPT_DIR}/.env"
CONFIG_DIR_HOST="${SCRIPT_DIR}/config"
DATA_DIR_HOST="${SCRIPT_DIR}/data"
VENV_DIR="${SCRIPT_DIR}/venv"
VENV_PY="${VENV_DIR}/bin/python3"
VENV_PIP="${VENV_DIR}/bin/pip"
VENV_UV="${VENV_DIR}/bin/uvicorn"

# ── 偵測容器引擎 ──────────────────────────────────────────────────────────────
RUNTIME=""
for rt in podman docker; do
    command -v "$rt" &>/dev/null && RUNTIME="$rt" && break
done

# ── 輔助函式 ──────────────────────────────────────────────────────────────────
ts()         { date '+%H:%M:%S'; }
ok()         { echo -e " ${G}✓${N}  $*"; }
warn()       { echo -e " ${Y}⚠${N}  $*"; }
err()        { echo -e " ${R}✗${N}  $*"; }
step()       { echo -e "\n${B}[$1/$2] $3${N}  ${D}$(ts)${N}"; }
hline()      { echo -e "${D}────────────────────────────────────────${N}"; }

is_running() { $RUNTIME ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; }
is_exists()  { $RUNTIME ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; }

need_runtime() {
    # 用 if（而非 `cond && {…}`）：在 set -e 下，找到 runtime 時這行會回傳 1，
    # 會讓整個腳本「無聲無息」直接結束。改 if 才能在成功路徑回傳 0。
    if [ -z "$RUNTIME" ]; then err "找不到 podman 或 docker"; exit 1; fi
}

need_venv() {
    if [ ! -f "$VENV_PY" ]; then err "虛擬環境不存在，請先執行 ./install.sh"; exit 1; fi
}

load_env() {
    [ -f "$ENV_FILE" ] || { err "找不到 .env，請先執行 ./install.sh"; exit 1; }
    set -a; source "$ENV_FILE"; set +a
}

# 啟動容器（同時掛 config/ 與 data/）
run_container() {
    local port="${PORT:-8080}"
    $RUNTIME run -d \
        --name "$CONTAINER" \
        -p "${PORT:-8080}:${PORT:-8080}" \
        --env-file "$ENV_FILE" \
        -e HISTORY_DB=/data/history.db \
        -v "${CONFIG_DIR_HOST}:/config:z" \
        -v "${DATA_DIR_HOST}:/data:z" \
        --restart unless-stopped \
        "$IMAGE" > /dev/null
    echo -e "  容器名稱：${C}${CONTAINER}${N}"
    echo -e "  Web 介面：${C}http://localhost:${port}${N}"
    echo -e "  設定路徑：${C}${CONFIG_DIR_HOST}${N}"
    echo -e "  資料路徑：${C}${DATA_DIR_HOST}/history.db${N}"
}

# ── cmd_venv：建立 / 更新本機 Python 虛擬環境 ────────────────────────────────
cmd_venv() {
    local quiet="${1:-}"
    if [ -z "$quiet" ]; then echo -e "${B}── Python 虛擬環境 ──────────────────────────${N}"; fi

    if [ ! -d "$VENV_DIR" ]; then
        echo -n "  建立 venv... "
        python3 -m venv "$VENV_DIR"
        echo -e "${G}完成${N}"
    else
        if [ -z "$quiet" ]; then echo -e "  venv 已存在：${D}${VENV_DIR}${N}"; fi
    fi

    echo -n "  安裝/更新相依套件... "
    "$VENV_PIP" install --quiet --upgrade pip
    "$VENV_PIP" install --quiet -r app/requirements.txt
    echo -e "${G}完成${N}"

    if [ -z "$quiet" ]; then echo -e "\n  啟用方式：${C}source venv/bin/activate${N}"; fi
}

# ── cmd_install：互動式完整安裝 ───────────────────────────────────────────────
cmd_install() {
    need_runtime

    echo -e "${C}"
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║      UPS Monitor  安裝程式           ║"
    echo "  ╚══════════════════════════════════════╝"
    echo -e "${N}"

    TOTAL=6

    # ── [1/6] 檢查環境
    step 1 $TOTAL "檢查環境"
    echo -e "  容器引擎：${C}${RUNTIME}${N}  $($RUNTIME --version 2>&1 | head -1)"
    echo -e "  Python   ：${C}$(python3 --version 2>&1)${N}"
    echo -e "  工作目錄 ：${D}${SCRIPT_DIR}${N}"

    # 讀取舊設定
    source "$ENV_FILE" 2>/dev/null || true

    # ── [2/6] 設定
    step 2 $TOTAL "設定"

    prompt() {
        local msg="$1" cur="$2" var="$3"
        [ -n "$cur" ] && echo -ne "  ${msg} [${cur}]: " || echo -ne "  ${msg}: "
        read -r _in
        printf -v "$var" '%s' "${_in:-$cur}"
    }

    prompt "LINE Channel Secret（留空可稍後設定）"      "${CHANNEL_SECRET:-}"      CHANNEL_SECRET
    prompt "LINE Channel Access Token（留空可稍後設定）" "${LINE_ACCESS_TOKEN:-}"   LINE_ACCESS_TOKEN
    prompt "管理員 LINE User ID（留空可稍後設定）"      "${ADMIN_USER_ID:-}"       ADMIN_USER_ID
    prompt "UPS 名稱"                                   "${UPS_NAME:-eaton5cs}"    UPS_NAME
    prompt "NUT daemon 主機"                            "${NUT_HOST:-localhost}"    NUT_HOST
    prompt "NUT 帳號（留空=匿名）"                     "${NUT_USER:-}"            NUT_USER
    prompt "NUT 密碼（留空=匿名）"                     "${NUT_PASSWORD:-}"        NUT_PASSWORD
    prompt "Web 介面埠號"                               "${PORT:-8080}"            PORT
    prompt "電費單價 元/kWh（0=不顯示）"               "${ELECTRICITY_RATE:-0}"   ELECTRICITY_RATE

    # ── [3/6] 建立設定檔與目錄
    step 3 $TOTAL "建立設定檔與目錄"
    cat > "$ENV_FILE" << ENVEOF
# ── LINE Messaging API ────────────────────────────────────────────────────────
CHANNEL_SECRET=${CHANNEL_SECRET}
LINE_ACCESS_TOKEN=${LINE_ACCESS_TOKEN}
ADMIN_USER_ID=${ADMIN_USER_ID}

# ── NUT daemon ────────────────────────────────────────────────────────────────
NUT_HOST=${NUT_HOST:-localhost}
NUT_PORT=${NUT_PORT:-3493}
UPS_NAME=${UPS_NAME}
NUT_USER=${NUT_USER:-}
NUT_PASSWORD=${NUT_PASSWORD:-}

# ── Web 介面 ──────────────────────────────────────────────────────────────────
PORT=${PORT}
ELECTRICITY_RATE=${ELECTRICITY_RATE}
ENVEOF
    ok ".env 已儲存"

    mkdir -p "${CONFIG_DIR_HOST}" "${DATA_DIR_HOST}"
    chmod 777 "${CONFIG_DIR_HOST}" "${DATA_DIR_HOST}"
    ok "目錄建立完成"
    echo -e "  ${D}config → ${CONFIG_DIR_HOST}${N}"
    echo -e "  ${D}data   → ${DATA_DIR_HOST}${N}"

    # ── [4/6] Python 虛擬環境
    step 4 $TOTAL "Python 虛擬環境"
    cmd_venv quiet

    # 更新 settings.json 中的 electricity_rate
    if [ -f "${CONFIG_DIR_HOST}/settings.json" ]; then
        "$VENV_PY" - << PYEOF
import json
with open('${CONFIG_DIR_HOST}/settings.json') as f: s = json.load(f)
s['electricity_rate'] = float('${ELECTRICITY_RATE}' or 0)
with open('${CONFIG_DIR_HOST}/settings.json', 'w') as f: json.dump(s, f, indent=2, ensure_ascii=False)
PYEOF
        ok "settings.json electricity_rate → ${ELECTRICITY_RATE}"
    fi

    # ── [5/6] 建置容器映像
    step 5 $TOTAL "建置容器映像"

    # 預先下載 Chart.js（加速 build）
    if [ ! -s "static/chart.min.js" ]; then
        echo -n "  下載 Chart.js... "
        "$VENV_PY" -c "
import urllib.request, os
try:
    urllib.request.urlretrieve('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', 'static/chart.min.js')
    print(f'完成 ({os.path.getsize(\"static/chart.min.js\")} bytes)')
except Exception as e:
    print(f'略過（{e}）')
" 2>/dev/null || echo "略過"
    else
        ok "Chart.js 已存在，略過下載"
    fi

    echo -ne "  建置映像 ${IMAGE}... "
    local t0=$SECONDS
    if $RUNTIME build -t "$IMAGE" . > /tmp/ups-build.log 2>&1; then
        echo -e "${G}完成${N}  ${D}($((SECONDS - t0))s)${N}"
    else
        echo -e "${R}失敗！${N}"
        err "建置日誌 /tmp/ups-build.log 最後 20 行："
        tail -20 /tmp/ups-build.log
        exit 1
    fi

    # ── [6/6] 啟動服務
    step 6 $TOTAL "啟動服務"
    if is_exists; then
        echo -n "  移除舊容器... "
        $RUNTIME rm -f "$CONTAINER" > /dev/null
        echo -e "${Y}已移除${N}"
    fi
    echo -n "  啟動新容器... "
    $RUNTIME run -d \
        --name "$CONTAINER" \
        -p "${PORT:-8080}:${PORT:-8080}" \
        --env-file "$ENV_FILE" \
        -e HISTORY_DB=/data/history.db \
        -v "${CONFIG_DIR_HOST}:/config:z" \
        -v "${DATA_DIR_HOST}:/data:z" \
        --restart unless-stopped \
        "$IMAGE" > /dev/null
    echo -e "${G}完成${N}"

    # systemd（Podman rootless）
    if [ "$RUNTIME" = "podman" ]; then
        UDIR="${HOME}/.config/systemd/user"
        mkdir -p "$UDIR"
        echo -n "  設定開機自動啟動（systemd）... "
        $RUNTIME generate systemd --name "$CONTAINER" --restart-policy=always \
            > "${UDIR}/ups-monitor.service" 2>/dev/null || true
        systemctl --user daemon-reload 2>/dev/null || true
        systemctl --user enable ups-monitor 2>/dev/null || true
        loginctl enable-linger "$USER" 2>/dev/null || true
        echo -e "${G}完成${N}"
    fi

    # ── 安裝完成摘要
    echo ""
    hline
    echo -e "${G}${B}  ✓ 安裝完成！${N}  ${D}$(ts)${N}"
    hline
    echo -e "  Web 介面  ：${C}http://localhost:${PORT}${N}"
    echo -e "  容器名稱  ：${C}${CONTAINER}${N}"
    echo -e "  設定目錄  ：${D}${CONFIG_DIR_HOST}${N}"
    echo -e "  歷史資料  ：${D}${DATA_DIR_HOST}/history.db${N}"
    echo -e "  本機直跑  ：${C}./install.sh run-local${N}"
    echo -e "  即時日誌  ：${C}./install.sh logs${N}"
    hline

    { [ -z "${LINE_ACCESS_TOKEN:-}" ] || [ -z "${ADMIN_USER_ID:-}" ]; } && \
        warn "LINE 設定未完整，請編輯 .env 後執行 ${C}./install.sh update${N}"
    echo ""
}

# ── cmd_run_local：不用容器，直接以 venv 執行（不需要 podman/docker）────────
cmd_run_local() {
    # venv 不存在就自動建立，不需要容器引擎
    if [ ! -f "$VENV_PY" ]; then
        echo -e "${Y}虛擬環境不存在，自動建立中...${N}"
        cmd_venv quiet
    fi

    # 載入 .env（若存在）；不存在只發警告，仍可繼續
    if [ -f "$ENV_FILE" ]; then
        set -a; source "$ENV_FILE"; set +a
    else
        warn ".env 不存在，使用預設值（NUT_HOST=localhost, PORT=8080）"
        warn "若需自訂請先複製：${C}cp .env.example .env${N}"
    fi

    # run-local 直接跑在宿主機，host.containers.internal 只在容器內有效，自動換回 localhost
    if [ "${NUT_HOST:-}" = "host.containers.internal" ]; then
        export NUT_HOST=localhost
        warn "run-local：NUT_HOST host.containers.internal → ${C}localhost${N}"
    fi

    export CONFIG_DIR="${CONFIG_DIR_HOST}"
    export STATIC_DIR="${SCRIPT_DIR}/static"
    export HISTORY_DB="${DATA_DIR_HOST}/history.db"
    export PYTHONPATH="${SCRIPT_DIR}/app"

    mkdir -p "${CONFIG_DIR_HOST}" "${DATA_DIR_HOST}"

    hline
    echo -e "${G}${B}  UPS Monitor（本機模式）${N}"
    hline
    echo -e "  venv      : ${D}${VENV_DIR}${N}"
    echo -e "  config    : ${D}${CONFIG_DIR_HOST}${N}"
    echo -e "  history   : ${D}${DATA_DIR_HOST}/history.db${N}"
    echo -e "  static    : ${D}${SCRIPT_DIR}/static${N}"
    echo -e "  URL       : ${C}http://localhost:${PORT:-8080}${N}"
    echo -e "  停止      : ${Y}Ctrl+C${N}"
    hline
    echo ""

    cd "${SCRIPT_DIR}/app"
    exec "$VENV_UV" main:app \
        --host 0.0.0.0 \
        --port "${PORT:-8080}" \
        --reload \
        --reload-dir "${SCRIPT_DIR}/app"
}

# ── 容器管理指令 ──────────────────────────────────────────────────────────────
cmd_start() {
    need_runtime
    if is_running; then
        warn "容器已在運行中"
    elif is_exists; then
        echo -n "  啟動容器... "
        $RUNTIME start "$CONTAINER" > /dev/null
        ok "已啟動  ${C}${CONTAINER}${N}"
    else
        err "容器不存在，請先執行 ./install.sh"
        exit 1
    fi
}

cmd_stop() {
    need_runtime
    if is_running; then
        echo -n "  停止容器... "
        $RUNTIME stop "$CONTAINER" > /dev/null
        ok "已停止  ${Y}${CONTAINER}${N}"
    else
        warn "容器未運行"
    fi
}

cmd_restart() {
    need_runtime
    echo -n "  重啟容器 ${CONTAINER}... "
    $RUNTIME restart "$CONTAINER" > /dev/null
    ok "已重啟"
}

cmd_update() {
    need_runtime
    need_venv
    load_env

    hline
    echo -e "${B}  UPS Monitor 更新${N}  ${D}$(ts)${N}"
    hline

    echo -e "\n${B}[1/3] 更新 Python 套件${N}"
    "$VENV_PIP" install --quiet --upgrade -r app/requirements.txt
    ok "套件更新完成"

    echo -e "\n${B}[2/3] 重新建置映像${N}"
    echo -ne "  建置 ${IMAGE}... "
    local t0=$SECONDS
    if $RUNTIME build -t "$IMAGE" . > /tmp/ups-build.log 2>&1; then
        echo -e "${G}完成${N}  ${D}($((SECONDS - t0))s)${N}"
    else
        echo -e "${R}失敗！${N}"
        tail -20 /tmp/ups-build.log
        exit 1
    fi

    echo -e "\n${B}[3/3] 重啟容器${N}"
    if is_exists; then
        echo -n "  移除舊容器... "
        $RUNTIME rm -f "$CONTAINER" > /dev/null
        echo -e "${Y}完成${N}"
    fi
    echo -n "  啟動新容器... "
    $RUNTIME run -d \
        --name "$CONTAINER" \
        -p "${PORT:-8080}:${PORT:-8080}" \
        --env-file "$ENV_FILE" \
        -e HISTORY_DB=/data/history.db \
        -v "${CONFIG_DIR_HOST}:/config:z" \
        -v "${DATA_DIR_HOST}:/data:z" \
        --restart unless-stopped \
        "$IMAGE" > /dev/null
    ok "已啟動"

    echo ""
    hline
    echo -e "${G}${B}  ✓ 更新完成！${N}  ${D}$(ts)${N}"
    echo -e "  Web 介面：${C}http://localhost:${PORT:-8080}${N}"
    hline
    echo ""
}

cmd_status() {
    need_runtime
    load_env 2>/dev/null || true

    hline
    echo -e "${B}  UPS Monitor 狀態${N}  ${D}$(ts)${N}"
    hline

    # 容器
    if is_running; then
        echo -e "  容器狀態：${G}運行中${N}  ${D}(${CONTAINER})${N}"
        $RUNTIME stats --no-stream \
            --format "  CPU: {{.CPUPerc}}  記憶體: {{.MemUsage}}" \
            "$CONTAINER" 2>/dev/null || true
    else
        echo -e "  容器狀態：${R}已停止${N}"
    fi

    # venv
    [ -f "$VENV_PY" ] \
        && echo -e "  venv    ：${G}存在${N}  ${D}${VENV_DIR}${N}" \
        || echo -e "  venv    ：${Y}未建立${N}"

    # 路徑與資料
    echo -e "  設定檔  ：${D}${CONFIG_DIR_HOST}/settings.json${N}"
    if [ -f "${DATA_DIR_HOST}/history.db" ]; then
        local dbsize
        dbsize=$(du -sh "${DATA_DIR_HOST}/history.db" 2>/dev/null | cut -f1)
        echo -e "  歷史 DB ：${G}${DATA_DIR_HOST}/history.db${N}  ${D}(${dbsize})${N}"
    else
        echo -e "  歷史 DB ：${Y}尚無資料${N}  ${D}${DATA_DIR_HOST}/history.db${N}"
    fi

    # 服務 URL
    echo -e "  Web 介面：${C}http://localhost:${PORT:-8080}${N}"

    echo ""
    hline
    echo -e "${B}  最近日誌（30 行）${N}"
    hline
    $RUNTIME logs --tail 30 "$CONTAINER" 2>&1 || echo "  (無日誌)"
}

cmd_logs() {
    need_runtime
    echo -e "${D}  追蹤 ${CONTAINER} 日誌，Ctrl+C 離開${N}"
    $RUNTIME logs -f "$CONTAINER"
}

# ── 主程式 ────────────────────────────────────────────────────────────────────
CMD="${1:-install}"
case "$CMD" in
    install)   cmd_install   ;;
    venv)      cmd_venv      ;;
    run-local) cmd_run_local ;;
    start)     cmd_start     ;;
    stop)      cmd_stop      ;;
    restart)   cmd_restart   ;;
    update)    cmd_update    ;;
    status)    cmd_status    ;;
    logs)      cmd_logs      ;;
    *)
        echo -e "使用方式：$0 ${C}[install|venv|run-local|start|stop|restart|update|status|logs]${N}"
        exit 1 ;;
esac
