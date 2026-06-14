import asyncio
import json
import logging
import os
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

# asyncssh 透過已棄用路徑匯入 ARC4/TripleDES，會在啟動時噴出 CryptographyDeprecationWarning。
# 這是上游相依性的問題、與本服務無關，於匯入 asyncssh（經由 actions/ssh_hosts）前先消音。
warnings.filterwarnings("ignore", message=r"(ARC4|TripleDES) has been moved")

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import actions
import history
import ssh_hosts
from monitor import UPSMonitor
from notifier import LineNotifier
from nut_client import NUTClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

CONFIG_DIR  = Path(os.getenv("CONFIG_DIR",  "/config"))
STATIC_DIR  = os.getenv("STATIC_DIR", "/static")
SETTINGS_PATH = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS: dict = {
    "check_interval": 30,
    "electricity_rate": 0,
    "notifications": {
        "on_battery": {
            "enabled": True,
            "message": "⚠️ UPS 切換至電池供電！電力中斷，請注意",
            "cooldown": 300,
        },
        "battery_low": {
            "enabled": True,
            "message": "🔴 UPS 電池電量低！目前電量: {battery_charge}%",
            "cooldown": 300,
            "threshold": 30,
        },
        "battery_critical": {
            "enabled": True,
            "message": "🆘 UPS 電池嚴重不足！剩餘 {battery_charge}%，約 {battery_runtime} 分鐘",
            "cooldown": 120,
            "threshold": 15,
        },
        "power_restored": {
            "enabled": True,
            "message": "✅ 市電已恢復，UPS 切回正常供電",
            "cooldown": 60,
        },
        "overload": {
            "enabled": True,
            "message": "⚡ UPS 過載警告！目前負載: {ups_load}%",
            "cooldown": 300,
            "threshold": 90,
        },
    },
    # 觸發遠端 SSH 指令的動作清單；每筆：
    # {id, name, enabled, trigger(事件key), host_id, command, cooldown}
    "actions": [],
}


def load_settings() -> dict:
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH) as f:
                return json.load(f)
        except Exception as exc:
            logger.error("Failed to load settings: %s", exc)
    return DEFAULT_SETTINGS.copy()


def save_settings(data: dict) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_PATH, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


NUT_HOST         = os.getenv("NUT_HOST", "localhost")
NUT_PORT         = int(os.getenv("NUT_PORT", "3493"))
UPS_NAME         = os.getenv("UPS_NAME", "eaton5cs")
NUT_USER         = os.getenv("NUT_USER", "").strip() or None
NUT_PASSWORD     = os.getenv("NUT_PASSWORD", "").strip() or None
LINE_ACCESS_TOKEN = os.getenv("LINE_ACCESS_TOKEN", "").strip()
ADMIN_USER_ID    = os.getenv("ADMIN_USER_ID", "").strip()

nut_client = NUTClient(NUT_HOST, NUT_PORT, UPS_NAME, NUT_USER, NUT_PASSWORD)
notifier   = LineNotifier(LINE_ACCESS_TOKEN or None, ADMIN_USER_ID or None)
monitor    = UPSMonitor(nut_client, notifier, load_settings,
                        host_getter=ssh_hosts.get_host,
                        action_runner=actions.run_command)

ws_clients: set = set()


async def broadcast(data: dict) -> None:
    if not ws_clients:
        return
    payload = json.dumps(data)
    dead: set = set()
    for ws in ws_clients.copy():
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    ws_clients -= dead


monitor.add_callback(broadcast)
monitor.add_callback(history.record)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await history.init_db()
    if not SETTINGS_PATH.exists():
        save_settings(DEFAULT_SETTINGS)

    poll_task = asyncio.create_task(monitor.run())

    async def _daily_prune():
        while True:
            await asyncio.sleep(86_400)
            await history.prune()

    prune_task = asyncio.create_task(_daily_prune())

    yield

    monitor.stop()
    poll_task.cancel()
    prune_task.cancel()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    # 前端資源（index 與 /static）一律不快取，避免瀏覽器執行到舊版 JS/CSS
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _asset_version() -> int:
    """以靜態資源最新的 mtime 作為版本號，確保前端改動後瀏覽器一定重新抓取。"""
    try:
        return int(max(
            os.path.getmtime(os.path.join(STATIC_DIR, f))
            for f in ("app.js", "style.css", "chart.min.js")
        ))
    except OSError:
        return 0


@app.get("/")
async def root():
    with open(f"{STATIC_DIR}/index.html", encoding="utf-8") as f:
        html = f.read()
    html = html.replace("__ASSET_V__", str(_asset_version()))
    return HTMLResponse(html)


@app.get("/api/status")
async def get_status():
    return monitor.current_data


@app.get("/api/settings")
async def get_settings():
    return load_settings()


@app.put("/api/settings")
async def put_settings(request: Request):
    data = await request.json()
    save_settings(data)
    return {"ok": True}


@app.get("/api/hosts")
async def list_hosts():
    return ssh_hosts.list_hosts()


@app.post("/api/hosts")
async def create_host(request: Request):
    d = await request.json()
    try:
        rec = await asyncio.to_thread(
            ssh_hosts.create_host,
            d.get("name"), d.get("username"), d.get("host"),
            d.get("port", 22), d.get("private_key", ""),
        )
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:
        logger.error("create_host failed: %s", exc)
        return JSONResponse({"ok": False, "error": "建立主機失敗"}, status_code=500)
    return {"ok": True, "host": rec}


@app.delete("/api/hosts/{host_id}")
async def delete_host(host_id: str):
    return {"ok": ssh_hosts.delete_host(host_id)}


@app.post("/api/hosts/{host_id}/test")
async def test_host(host_id: str):
    host = ssh_hosts.get_host(host_id)
    if not host:
        return JSONResponse({"ok": False, "error": "找不到主機"}, status_code=404)
    return await actions.run_command(host, "echo ok", timeout=15)


@app.post("/api/actions/{action_id}/run")
async def run_action(action_id: str):
    s = load_settings()
    action = next((a for a in s.get("actions", []) if str(a.get("id")) == action_id), None)
    if not action:
        return JSONResponse({"ok": False, "error": "找不到動作"}, status_code=404)
    host = ssh_hosts.get_host(action.get("host_id"))
    if not host:
        return JSONResponse({"ok": False, "error": "動作所屬主機不存在"}, status_code=400)
    return await actions.run_command(host, action.get("command", ""), timeout=30)


@app.get("/api/history")
async def get_history(range: str = "24h"):
    return await history.get_history(range)


@app.get("/api/stats")
async def get_stats():
    s = load_settings()
    rate = float(s.get("electricity_rate", 0))
    return await history.get_stats(rate)


@app.post("/api/notify/test")
async def test_notify():
    ok = await notifier.send("🔔 UPS Monitor 測試通知 — 連線正常")
    return {
        "ok": ok,
        "token_set":   bool(LINE_ACCESS_TOKEN),
        "user_id_set": bool(ADMIN_USER_ID),
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    ws_clients.add(ws)
    try:
        if monitor.current_data:
            await ws.send_text(json.dumps(monitor.current_data))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)
