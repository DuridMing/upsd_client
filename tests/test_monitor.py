import pytest

from monitor import UPSMonitor


class FakeNotifier:
    def __init__(self, ok=True):
        self.ok = ok
        self.sent = []

    async def send(self, message, *, title=None, level="info", tags=None):
        self.sent.append({"message": message, "title": title, "level": level, "tags": tags})
        return self.ok


def settings_for(key):
    return {"notifications": {key: {"enabled": True, "message": "msg {battery_charge}",
                                     "cooldown": 300}}}


def make_monitor(notifier):
    return UPSMonitor(nut_client=None, notifier=notifier, settings_loader=dict)


@pytest.mark.parametrize("key,level,title", [
    ("on_battery", "warning", "UPS 改用電池供電"),
    ("battery_low", "warning", "UPS 電量偏低"),
    ("battery_critical", "critical", "UPS 電量嚴重不足"),
    ("overload", "error", "UPS 過載"),
    ("power_restored", "info", "UPS 市電恢復"),
])
async def test_each_event_has_level_and_title(key, level, title):
    notifier = FakeNotifier()
    monitor = make_monitor(notifier)

    await monitor._dispatch_notifications({key}, {"battery.charge": "42"}, settings_for(key))

    assert notifier.sent == [
        {"message": "msg 42", "title": title, "level": level, "tags": ["ups", key]},
    ]


async def test_failed_send_resets_cooldown():
    notifier = FakeNotifier(ok=False)
    monitor = make_monitor(notifier)
    settings = settings_for("on_battery")

    await monitor._dispatch_notifications({"on_battery"}, {}, settings)
    await monitor._dispatch_notifications({"on_battery"}, {}, settings)

    assert len(notifier.sent) == 2


async def test_successful_send_respects_cooldown():
    notifier = FakeNotifier(ok=True)
    monitor = make_monitor(notifier)
    settings = settings_for("on_battery")

    await monitor._dispatch_notifications({"on_battery"}, {}, settings)
    await monitor._dispatch_notifications({"on_battery"}, {}, settings)

    assert len(notifier.sent) == 1
