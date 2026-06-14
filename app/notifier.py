import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"


class LineNotifier:
    def __init__(self, access_token: Optional[str], user_id: Optional[str]):
        self.access_token = access_token
        self.user_id = user_id

    async def send(self, message: str) -> bool:
        if not self.access_token:
            logger.warning("LINE_ACCESS_TOKEN not set, skipping notification")
            return False
        if not self.user_id:
            logger.warning("ADMIN_USER_ID not set, skipping notification")
            return False
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    LINE_PUSH_URL,
                    headers={
                        "Authorization": f"Bearer {self.access_token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "to": self.user_id,
                        "messages": [{"type": "text", "text": message}],
                    },
                    timeout=10,
                )
                if resp.status_code == 200:
                    logger.info("LINE push sent to %s", self.user_id)
                    return True
                logger.error("LINE push failed: %s %s", resp.status_code, resp.text)
                return False
        except Exception as exc:
            logger.error("LINE push error: %s", exc)
            return False
