import asyncio

import pytest
from starlette.websockets import WebSocketDisconnect

from app.lsp import _frame, _read_message
from tests.conftest import register


def test_frame_uses_byte_length_not_char_length():
    # « é » fait 2 octets en UTF-8 : le Content-Length doit compter les octets.
    framed = _frame('{"k":"é"}')
    head, body = framed.split(b"\r\n\r\n", 1)
    assert head == b"Content-Length: 10"
    assert body.decode("utf-8") == '{"k":"é"}'


async def _read_one(raw: bytes) -> str | None:
    reader = asyncio.StreamReader()
    reader.feed_data(raw)
    reader.feed_eof()
    return await _read_message(reader)


def test_read_message_roundtrips_a_framed_message():
    message = '{"jsonrpc":"2.0","id":1,"result":null}'
    assert asyncio.run(_read_one(_frame(message))) == message


def test_read_message_returns_none_on_eof():
    assert asyncio.run(_read_one(b"")) is None


def test_lsp_rejects_unsupported_language(client):
    with pytest.raises(WebSocketDisconnect):  # noqa: SIM117
        with client.websocket_connect("/api/lsp/java"):
            pass


def test_lsp_rejects_unauthenticated(client):
    with pytest.raises(WebSocketDisconnect):  # noqa: SIM117
        with client.websocket_connect("/api/lsp/cpp"):
            pass


def test_lsp_closes_gracefully_when_clangd_absent(client, monkeypatch):
    # Authentifié mais clangd indisponible : le serveur accepte puis ferme avec
    # 1011, et le client retombe sur l'auto-complétion statique.
    monkeypatch.setattr("app.lsp.shutil.which", lambda _name: None)
    register(client)
    with client.websocket_connect("/api/lsp/cpp") as ws:  # noqa: SIM117
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
    assert exc.value.code == 1011
