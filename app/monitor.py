import asyncio
import logging
import time
from typing import Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# 各事件預設訊息（設定缺漏時的後備）
DEFAULT_MESSAGES = {
    "on_battery":       "⚠️ UPS 切換至電池供電",
    "power_restored":   "✅ 市電已恢復",
    "battery_critical": "🆘 電池嚴重不足",
    "battery_low":      "🔴 電池電量低",
    "overload":         "⚡ UPS 過載",
}
# 送到 NotifySystem 時的標題與等級（等級決定各平台的顯示方式和規則比對）
EVENT_META = {
    "on_battery":       ("UPS 改用電池供電", "warning"),
    "power_restored":   ("UPS 市電恢復", "info"),
    "battery_critical": ("UPS 電量嚴重不足", "critical"),
    "battery_low":      ("UPS 電量偏低", "warning"),
    "overload":         ("UPS 過載", "error"),
}
DEFAULT_COOLDOWNS = {
    "on_battery": 300, "power_restored": 60,
    "battery_critical": 120, "battery_low": 300, "overload": 300,
}


class UPSMonitor:
    def __init__(self, nut_client, notifier, settings_loader: Callable,
                 host_getter: Optional[Callable[[str], Optional[dict]]] = None,
                 action_runner: Optional[Callable[..., Awaitable[dict]]] = None):
        self.nut_client = nut_client
        self.notifier = notifier
        self.get_settings = settings_loader
        # host_getter(host_id) -> 完整主機設定（含 key_path）；action_runner(host, command) -> result
        self.get_host = host_getter
        self.run_action = action_runner
        self.current_data: dict = {}
        self.previous_status: str = ""
        self.last_notif_time: Dict[str, float] = {}
        self._callbacks: List[Callable] = []
        self._running = False

    def add_callback(self, cb: Callable) -> None:
        self._callbacks.append(cb)

    def _cooldown_ok(self, key: str, cooldown: int) -> bool:
        now = time.time()
        if now - self.last_notif_time.get(key, 0) >= cooldown:
            self.last_notif_time[key] = now
            return True
        return False

    def _fmt(self, template: str, data: dict) -> str:
        try:
            runtime_min = int(float(data.get("battery.runtime", 0))) // 60
            return template.format(
                battery_charge=data.get("battery.charge", "--"),
                battery_runtime=runtime_min,
                ups_load=data.get("ups.load", "--"),
            )
        except Exception:
            return template

    def _detect_events(self, data: dict, settings: dict) -> set:
        """根據目前資料與門檻判定當下觸發了哪些事件（key 集合）。

        - on_battery / power_restored 為狀態邊緣事件（與 previous_status 比較）。
        - battery_low / battery_critical / overload 為門檻事件（持續成立每輪皆觸發，靠 cooldown 節流）。
        門檻一律取自 notifications 設定，動作與通知共用同一組門檻。
        """
        status = data.get("ups.status", "")
        notif = settings.get("notifications", {})
        events: set = set()

        try:
            charge = float(data.get("battery.charge", 100))
            load = float(data.get("ups.load", 0))
        except (ValueError, TypeError):
            charge, load = 100.0, 0.0

        if "OB" in status and "OB" not in self.previous_status:
            events.add("on_battery")
        if "OL" in status and "OB" in self.previous_status:
            events.add("power_restored")

        crit_th = float(notif.get("battery_critical", {}).get("threshold", 15))
        low_th = float(notif.get("battery_low", {}).get("threshold", 30))
        if charge <= crit_th:
            events.add("battery_critical")
        elif charge <= low_th:                      # 嚴重不足優先，兩者互斥
            events.add("battery_low")

        ol_th = float(notif.get("overload", {}).get("threshold", 90))
        if load >= ol_th:
            events.add("overload")

        self.previous_status = status
        return events

    async def _dispatch_notifications(self, events: set, data: dict, settings: dict) -> None:
        notif = settings.get("notifications", {})
        for key in events:
            cfg = notif.get(key, {})
            if not cfg.get("enabled"):
                continue
            cooldown = int(cfg.get("cooldown", DEFAULT_COOLDOWNS.get(key, 300)))
            if not self._cooldown_ok(f"notif:{key}", cooldown):
                continue
            message = self._fmt(cfg.get("message", DEFAULT_MESSAGES.get(key, key)), data)
            title, level = EVENT_META.get(key, (None, "info"))
            if not await self.notifier.send(message, title=title, level=level,
                                            tags=["ups", key]):
                # 送失敗時重置 cooldown，讓下一輪可重試
                self.last_notif_time.pop(f"notif:{key}", None)

    async def _dispatch_actions(self, events: set, settings: dict) -> None:
        if not (self.run_action and self.get_host):
            return
        for action in settings.get("actions", []):
            if not action.get("enabled"):
                continue
            if action.get("trigger") not in events:
                continue
            command = (action.get("command") or "").strip()
            if not command:
                continue
            aid = str(action.get("id"))
            cooldown = int(action.get("cooldown", 300))
            if not self._cooldown_ok(f"action:{aid}", cooldown):
                continue
            host = self.get_host(action.get("host_id"))
            if not host:
                logger.warning("action '%s': host %s 不存在，略過",
                               action.get("name"), action.get("host_id"))
                self.last_notif_time.pop(f"action:{aid}", None)
                continue
            try:
                result = await self.run_action(host, command)
                logger.info("action '%s' 於 %s 執行：exit=%s err=%s",
                            action.get("name"), host.get("host"),
                            result.get("exit_status"), result.get("error"))
            except Exception as exc:
                logger.error("action '%s' 執行例外：%s", action.get("name"), exc)

    async def _check(self, data: dict, settings: dict) -> None:
        events = self._detect_events(data, settings)
        if not events:
            return
        await self._dispatch_notifications(events, data, settings)
        await self._dispatch_actions(events, settings)

    async def poll(self) -> None:
        settings = self.get_settings()
        try:
            data = await self.nut_client.get_vars()
            self.current_data = data
            await self._check(data, settings)
            for cb in self._callbacks:
                try:
                    await cb(data)
                except Exception as exc:
                    logger.debug("callback error: %s", exc)
        except Exception as exc:
            logger.warning("UPS poll failed: %s", exc)

    async def run(self) -> None:
        self._running = True
        while self._running:
            settings = self.get_settings()
            interval = int(settings.get("check_interval", 30))
            await self.poll()
            await asyncio.sleep(max(5, interval))

    def stop(self) -> None:
        self._running = False
