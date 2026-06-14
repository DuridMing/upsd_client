import asyncio
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class NUTClient:
    def __init__(self, host: str, port: int, ups_name: str,
                 username: Optional[str] = None, password: Optional[str] = None):
        self.host = host
        self.port = port
        self.ups_name = ups_name
        self.username = username
        self.password = password

    async def _readline(self, reader) -> str:
        return (await asyncio.wait_for(reader.readline(), timeout=10)).decode().strip()

    async def _send(self, writer, cmd: str) -> None:
        writer.write((cmd + "\n").encode())
        await writer.drain()

    async def get_vars(self) -> dict:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port), timeout=10
        )
        try:
            # 帳密驗證（設定了才送）
            if self.username:
                await self._send(writer, f"USERNAME {self.username}")
                resp = await self._readline(reader)
                if not resp.startswith("OK"):
                    raise RuntimeError(f"NUT USERNAME rejected: {resp}")

            if self.password:
                await self._send(writer, f"PASSWORD {self.password}")
                resp = await self._readline(reader)
                if not resp.startswith("OK"):
                    raise RuntimeError(f"NUT PASSWORD rejected: {resp}")

            await self._send(writer, f"LIST VAR {self.ups_name}")

            data = b""
            while True:
                chunk = await asyncio.wait_for(reader.read(8192), timeout=10)
                if not chunk:
                    break
                data += chunk
                if b"END LIST VAR" in data:
                    break
                if data.startswith(b"ERR"):
                    raise RuntimeError(data.decode().strip())
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

        vars: dict = {}
        for line in data.decode(errors="replace").split("\n"):
            match = re.match(r'^VAR \S+ (\S+) "(.*)"', line)
            if match:
                vars[match.group(1)] = match.group(2)
        return vars
