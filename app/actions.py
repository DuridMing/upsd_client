"""透過 SSH 在遠端主機執行指令（例如電池過低時 `sudo shutdown`）。

使用 asyncssh 維持全程非同步；任何錯誤一律捕捉後回傳結果 dict，
絕不向上拋出例外而中斷輪詢迴圈。
"""
import asyncio
import logging

import asyncssh

logger = logging.getLogger(__name__)

_OUT_LIMIT = 2000  # 截斷遠端輸出，避免超大回應塞爆日誌 / WebSocket


async def run_command(host: dict, command: str, timeout: int = 20) -> dict:
    """在 host 上以其私鑰執行 command。

    host 需含 host / port / username / key_path（由 ssh_hosts.get_host 提供）。
    回傳：{ok, exit_status, stdout, stderr, error}
    """
    command = (command or "").strip()
    if not command:
        return {"ok": False, "exit_status": None, "stdout": "", "stderr": "",
                "error": "指令為空"}

    key_path = host.get("key_path")

    async def _exec() -> dict:
        async with asyncssh.connect(
            host["host"],
            port=int(host.get("port", 22)),
            username=host["username"],
            client_keys=[key_path],
            known_hosts=None,  # 家用 / 內網環境不做 host key 驗證
        ) as conn:
            result = await conn.run(command, check=False)
            return {
                "ok": result.exit_status == 0,
                "exit_status": result.exit_status,
                "stdout": (result.stdout or "")[:_OUT_LIMIT],
                "stderr": (result.stderr or "")[:_OUT_LIMIT],
                "error": None,
            }

    try:
        return await asyncio.wait_for(_exec(), timeout=timeout)
    except asyncio.TimeoutError:
        logger.error("SSH command timed out on %s after %ss", host.get("host"), timeout)
        return {"ok": False, "exit_status": None, "stdout": "", "stderr": "",
                "error": f"連線 / 執行逾時（{timeout}s）"}
    except Exception as exc:
        logger.error("SSH command failed on %s: %s", host.get("host"), exc)
        return {"ok": False, "exit_status": None, "stdout": "", "stderr": "",
                "error": str(exc)}
