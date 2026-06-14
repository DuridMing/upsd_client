"""寫入後即不可修改（write-once）的遠端主機憑證存放區。

設計重點：
- 主機 metadata 存於 CONFIG_DIR/hosts.json；私鑰各自寫成 CONFIG_DIR/ssh_keys/<id>.key（0600）。
- 對外只提供「建立 / 刪除」，刻意不提供更新，符合需求的「輸入後無法修改只能刪除」保護機制。
- 私鑰內容永遠不會回傳給前端 / API；只暴露 metadata 與公開指紋（fingerprint）供辨識。
"""
import json
import logging
import os
import time
import uuid
from pathlib import Path

import asyncssh

logger = logging.getLogger(__name__)

CONFIG_DIR = Path(os.getenv("CONFIG_DIR", "/config"))
HOSTS_PATH = CONFIG_DIR / "hosts.json"
KEYS_DIR = CONFIG_DIR / "ssh_keys"

# 對外公開的欄位（不含私鑰路徑），用於 API 回應與前端顯示
_PUBLIC_FIELDS = ("id", "name", "username", "host", "port", "fingerprint", "created_at")


def _load() -> list:
    if HOSTS_PATH.exists():
        try:
            with open(HOSTS_PATH) as f:
                return json.load(f)
        except Exception as exc:
            logger.error("Failed to load hosts.json: %s", exc)
    return []


def _save(hosts: list) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(HOSTS_PATH, "w") as f:
        json.dump(hosts, f, indent=2, ensure_ascii=False)


def _public(h: dict) -> dict:
    return {k: h[k] for k in _PUBLIC_FIELDS if k in h}


def _key_path(host_id: str) -> Path:
    return KEYS_DIR / f"{host_id}.key"


def list_hosts() -> list:
    """回傳所有主機的公開 metadata（不含私鑰）。"""
    return [_public(h) for h in _load()]


def get_host(host_id: str) -> dict | None:
    """供後端執行用：回傳含 key_path 的完整設定；找不到回 None。"""
    for h in _load():
        if h.get("id") == host_id:
            return {**h, "key_path": str(_key_path(host_id))}
    return None


def create_host(name: str, username: str, host: str, port, private_key: str) -> dict:
    """建立一台主機。會驗證私鑰格式，失敗則丟出 ValueError。"""
    name = (name or "").strip()
    username = (username or "").strip()
    host = (host or "").strip()
    private_key = private_key or ""
    if not name or not username or not host:
        raise ValueError("名稱 / 帳號 / 位置 為必填")
    if not private_key.strip():
        raise ValueError("SSH 私鑰為必填")
    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 22

    # 驗證私鑰並取得公開指紋（無法解析時 asyncssh 會丟出例外）
    try:
        key = asyncssh.import_private_key(private_key)
    except Exception as exc:
        raise ValueError(f"SSH 私鑰格式無效：{exc}") from exc
    fingerprint = key.get_fingerprint()

    host_id = uuid.uuid4().hex[:12]
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    kp = _key_path(host_id)
    with open(kp, "w") as f:
        f.write(private_key if private_key.endswith("\n") else private_key + "\n")
    os.chmod(kp, 0o600)

    rec = {
        "id": host_id,
        "name": name,
        "username": username,
        "host": host,
        "port": port,
        "fingerprint": fingerprint,
        "created_at": int(time.time()),
    }
    hosts = _load()
    hosts.append(rec)
    _save(hosts)
    logger.info("SSH host created: %s (%s@%s)", name, username, host)
    return _public(rec)


def delete_host(host_id: str) -> bool:
    """刪除主機與其私鑰檔。沒有這台主機回 False。"""
    hosts = _load()
    remaining = [h for h in hosts if h.get("id") != host_id]
    if len(remaining) == len(hosts):
        return False
    _save(remaining)
    try:
        _key_path(host_id).unlink()
    except FileNotFoundError:
        pass
    logger.info("SSH host deleted: %s", host_id)
    return True
