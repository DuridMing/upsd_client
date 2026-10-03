import json
import logging

import httpx
import respx

from notifier import NotifySystemNotifier

HOOK = "http://192.168.77.241:8000/hooks/secret-key-123"


@respx.mock
async def test_posts_native_json_to_hook():
    route = respx.post(HOOK).mock(return_value=httpx.Response(202, json={"accepted": 1}))
    notifier = NotifySystemNotifier(HOOK)

    ok = await notifier.send("目前電量 25%", title="UPS 電量偏低", level="warning",
                             tags=["ups", "battery_low"])

    assert ok is True
    assert route.called
    sent = json.loads(route.calls.last.request.content)
    assert sent == {
        "title": "UPS 電量偏低",
        "body": "目前電量 25%",
        "level": "warning",
        "tags": ["ups", "battery_low"],
    }


@respx.mock
async def test_defaults_to_info_without_title():
    route = respx.post(HOOK).mock(return_value=httpx.Response(202))

    assert await NotifySystemNotifier(HOOK).send("hello") is True
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"body": "hello", "level": "info", "tags": ["ups"]}


@respx.mock
async def test_error_status_returns_false():
    respx.post(HOOK).mock(return_value=httpx.Response(404, json={"detail": "unknown hook"}))
    assert await NotifySystemNotifier(HOOK).send("x") is False


@respx.mock
async def test_server_error_returns_false():
    respx.post(HOOK).mock(return_value=httpx.Response(500))
    assert await NotifySystemNotifier(HOOK).send("x") is False


@respx.mock
async def test_connection_error_returns_false_without_raising():
    respx.post(HOOK).mock(side_effect=httpx.ConnectError("refused"))
    assert await NotifySystemNotifier(HOOK).send("x") is False


@respx.mock
async def test_missing_hook_url_skips_sending():
    route = respx.route()
    assert await NotifySystemNotifier(None).send("x") is False
    assert await NotifySystemNotifier("").send("x") is False
    assert not route.called


@respx.mock
async def test_hook_url_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    respx.post(HOOK).mock(side_effect=[
        httpx.Response(202),
        httpx.Response(404),
        httpx.ConnectError(f"cannot connect to {HOOK}"),
    ])
    notifier = NotifySystemNotifier(HOOK)
    for _ in range(3):
        await notifier.send("x")

    assert "secret-key-123" not in caplog.text
    assert "secret-key-123" not in repr(notifier)


def test_is_configured():
    assert NotifySystemNotifier(HOOK).configured is True
    assert NotifySystemNotifier(None).configured is False
