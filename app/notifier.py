import logging
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)
# httpx 的 INFO log 會印出完整網址（含 hook key）
logging.getLogger("httpx").setLevel(logging.WARNING)


class NotifySystemNotifier:
    """把通知送到 NotifySystem 的 webhook 來源（/hooks/{key}）。

    要送到哪些平台（LINE 等）、重試和速率限制都由 NotifySystem 處理；
    這裡只負責把訊息交出去。hook 網址含有 key，等同密碼，不寫進 log。
    """

    def __init__(self, hook_url: Optional[str]):
        self._hook_url = (hook_url or "").strip() or None

    @property
    def configured(self) -> bool:
        return self._hook_url is not None

    def __repr__(self) -> str:
        return f"NotifySystemNotifier(configured={self.configured})"

    async def send(self, message: str, *, title: Optional[str] = None,
                   level: str = "info", tags: Optional[List[str]] = None) -> bool:
        if not self._hook_url:
            logger.warning("NOTIFY_HOOK_URL not set, skipping notification")
            return False
        payload: dict = {"body": message, "level": level, "tags": tags or ["ups"]}
        if title:
            payload["title"] = title
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(self._hook_url, json=payload, timeout=10)
        except httpx.HTTPError as exc:
            # 例外訊息可能帶有網址，只記類型
            logger.error("NotifySystem unreachable: %s", type(exc).__name__)
            return False
        if resp.is_success:
            logger.info("notification sent to NotifySystem (level=%s)", level)
            return True
        logger.error("NotifySystem rejected notification: HTTP %s", resp.status_code)
        return False
