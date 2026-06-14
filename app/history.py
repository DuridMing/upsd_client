import os
import time
from pathlib import Path

import aiosqlite

DB_PATH = Path(
    os.getenv("HISTORY_DB") or
    Path(os.getenv("CONFIG_DIR", "/config")) / "history.db"
)

_DDL = """
CREATE TABLE IF NOT EXISTS readings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             INTEGER NOT NULL,
    status         TEXT,
    battery_charge REAL,
    realpower      REAL,
    load           REAL,
    input_voltage  REAL
);
CREATE INDEX IF NOT EXISTS idx_ts ON readings (ts);
"""


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_DDL)
        await db.commit()


def _f(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


async def record(data: dict) -> None:
    rp = _f(data.get("ups.realpower") or data.get("ups.power"))
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO readings
                   (ts, status, battery_charge, realpower, load, input_voltage)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    int(time.time()),
                    data.get("ups.status", ""),
                    _f(data.get("battery.charge")),
                    rp,
                    _f(data.get("ups.load")),
                    _f(data.get("input.voltage")),
                ),
            )
            await db.commit()
    except Exception:
        pass


# Range → (total_seconds, bucket_seconds)
_RANGES = {
    "1h":  (3_600,     60),
    "24h": (86_400,    300),
    "7d":  (604_800,   3_600),
    "30d": (2_592_000, 14_400),
}


async def get_history(range_str: str) -> dict:
    span, bucket = _RANGES.get(range_str, (86_400, 300))
    since = int(time.time()) - span

    async with aiosqlite.connect(DB_PATH) as db:
        sql = f"""
            SELECT
                (ts / {bucket}) * {bucket}   AS t,
                AVG(realpower)               AS power,
                AVG(battery_charge)          AS battery,
                AVG(load)                    AS load_pct
            FROM readings
            WHERE ts >= ?
            GROUP BY t
            ORDER BY t
        """
        async with db.execute(sql, (since,)) as cur:
            rows = await cur.fetchall()

    return {
        "labels":  [r[0] for r in rows],
        "power":   [round(r[1] or 0, 1) for r in rows],
        "battery": [round(r[2] or 0, 1) for r in rows],
        "load":    [round(r[3] or 0, 1) for r in rows],
    }


async def get_stats(rate: float = 0.0) -> dict:
    now = int(time.time())
    periods = {
        "today": now - 86_400,
        "week":  now - 604_800,
        "month": now - 2_592_000,
    }
    result: dict = {}
    async with aiosqlite.connect(DB_PATH) as db:
        for key, since in periods.items():
            async with db.execute(
                "SELECT ts, realpower FROM readings WHERE ts >= ? ORDER BY ts",
                (since,),
            ) as cur:
                rows = await cur.fetchall()
            kwh = _trapz_kwh(rows)
            result[key] = {
                "kwh": round(kwh, 3),
                "cost": round(kwh * rate, 1) if rate > 0 else None,
            }
    return result


def _trapz_kwh(rows: list) -> float:
    kwh = 0.0
    for i in range(1, len(rows)):
        dt = rows[i][0] - rows[i - 1][0]          # seconds
        avg_w = (rows[i][1] + rows[i - 1][1]) / 2
        kwh += avg_w * dt / 3_600_000              # W·s → kWh
    return kwh


async def prune(days: int = 90) -> None:
    cutoff = int(time.time()) - days * 86_400
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM readings WHERE ts < ?", (cutoff,))
        await db.commit()
