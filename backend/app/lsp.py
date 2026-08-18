"""Pont WebSocket ↔ clangd pour l'IntelliSense C/C++ de l'éditeur.

clangd parle le Language Server Protocol sur stdin/stdout, avec un cadrage par
en-tête « Content-Length » (comme HTTP). Côté navigateur on ne veut pas de ce
cadrage : on échange **un message JSON-RPC par trame WebSocket**. Ce module fait
donc la traduction dans les deux sens et lance un processus clangd par session.

clangd ne fait qu'analyser le code (complétion, survol, diagnostics) : il
n'exécute rien. L'exécution réelle reste du ressort de Judge0.
"""

import asyncio
import contextlib
import os
import shutil
import signal
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, _token_hash
from app.config import get_settings
from app.db import as_utc, get_db
from app.models import User, UserSession
from app.rate_limit import consume_rate_limit
from app.security import origin_allowed

router = APIRouter(prefix="/api", tags=["lsp"])

# Les serveurs de langage lisent/écrivent du LSP cadré « Content-Length ». On
# borne la taille des trames entrantes : un fichier de compétition fait quelques
# Ko, pas plus.
MAX_MESSAGE_BYTES = 512 * 1024

# Serveur de langage à lancer par langage : (binaire, arguments). Le binaire doit
# être présent là où tourne le backend (cf. Dockerfile / README pour le dév).
LANGUAGE_SERVERS: dict[str, tuple[str, list[str]]] = {
    "c": ("clangd", ["--log=error", "--pch-storage=memory", "--background-index=false"]),
    "cpp": ("clangd", ["--log=error", "--pch-storage=memory", "--background-index=false"]),
    "python": ("basedpyright-langserver", ["--stdio"]),
    "ocaml": ("ocamllsp", []),
}

_active_lock = asyncio.Lock()
_active_total = 0
_active_by_user: dict[int, int] = {}


async def _reserve_session(user_id: int) -> bool:
    global _active_total
    settings = get_settings()
    async with _active_lock:
        mine = _active_by_user.get(user_id, 0)
        if _active_total >= settings.lsp_max_sessions_global:
            return False
        if mine >= settings.lsp_max_sessions_per_user:
            return False
        _active_total += 1
        _active_by_user[user_id] = mine + 1
        return True


async def _release_session(user_id: int) -> None:
    global _active_total
    async with _active_lock:
        mine = _active_by_user.get(user_id, 0)
        if mine <= 1:
            _active_by_user.pop(user_id, None)
        else:
            _active_by_user[user_id] = mine - 1
        _active_total = max(0, _active_total - 1)


def _frame(message: str) -> bytes:
    """Cadre un message JSON-RPC pour le stdin du serveur de langage."""
    body = message.encode("utf-8")
    return f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body


async def _read_message(stdout: asyncio.StreamReader) -> str | None:
    """Lit un message LSP cadré depuis le stdout du serveur, ou None à la fin."""
    content_length: int | None = None
    while True:
        line = await stdout.readline()
        if not line:  # EOF : le serveur s'est arrêté
            return None
        if line in (b"\r\n", b"\n"):  # fin des en-têtes
            break
        if line.lower().startswith(b"content-length:"):
            content_length = int(line.split(b":", 1)[1].strip())
    if content_length is None:
        return None
    body = await stdout.readexactly(content_length)
    return body.decode("utf-8")


def _authenticate(websocket: WebSocket, db: Session) -> User | None:
    """Valide le cookie de session ; None si non authentifié."""
    token = websocket.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.get(UserSession, _token_hash(token))
    if session is None or as_utc(session.expires_at) < datetime.now(UTC):
        return None
    return session.user


@router.websocket("/lsp/{language}")
async def lsp_proxy(
    websocket: WebSocket,
    language: str,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    server = LANGUAGE_SERVERS.get(language)
    if server is None:
        await websocket.close(code=1003, reason="unsupported_language")
        return

    settings = get_settings()
    forwarded_proto = websocket.headers.get("x-forwarded-proto")
    scheme = (
        forwarded_proto.split(",", 1)[0].strip()
        if forwarded_proto
        else ("https" if websocket.url.scheme == "wss" else "http")
    )
    if not origin_allowed(
        websocket.headers.get("origin"),
        host=websocket.headers.get("host", ""),
        scheme=scheme,
        allowed_origins=settings.cors_origins,
    ):
        await websocket.close(code=1008, reason="bad_origin")
        return

    user = _authenticate(websocket, db)
    if user is None:
        await websocket.close(code=1008, reason="unauthenticated")
        return

    forwarded = websocket.headers.get("x-forwarded-for")
    ip = (
        forwarded.split(",", 1)[0].strip()
        if forwarded
        else (websocket.client.host if websocket.client else "unknown")
    )
    retry_after = consume_rate_limit(
        "lsp.connect",
        ip,
        limit=settings.lsp_connect_rate_limit_per_minute,
        window_s=60,
    )
    if retry_after is not None:
        await websocket.close(code=1013, reason="rate_limited")
        return

    binary, args = server
    binary_path = shutil.which(binary)
    if binary_path is None:
        # Serveur de langage absent (ex. dév sur l'hôte) : on ferme proprement, le
        # client retombe sur l'auto-complétion statique.
        await websocket.accept()
        await websocket.close(code=1011, reason="server_unavailable")
        return

    if not await _reserve_session(user.id):
        await websocket.close(code=1013, reason="too_many_lsp_sessions")
        return

    await websocket.accept()

    process: asyncio.subprocess.Process | None = None
    try:
        process = await asyncio.create_subprocess_exec(
            binary_path,
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        await _release_session(user.id)
        await websocket.close(code=1011, reason="server_unavailable")
        return
    assert process.stdin is not None and process.stdout is not None
    stdin, stdout = process.stdin, process.stdout

    async def browser_to_server() -> None:
        while True:
            message = await websocket.receive_text()
            if len(message.encode("utf-8")) > MAX_MESSAGE_BYTES:
                await websocket.close(code=1009, reason="message_too_large")
                return
            stdin.write(_frame(message))
            await stdin.drain()

    async def server_to_browser() -> None:
        while True:
            message = await _read_message(stdout)
            if message is None:
                return
            await websocket.send_text(message)

    t1 = asyncio.create_task(browser_to_server())
    t2 = asyncio.create_task(server_to_browser())
    try:
        async with asyncio.timeout(settings.lsp_session_ttl_s):
            done, pending = await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
    except TimeoutError:
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=1000, reason="session_expired")
    except WebSocketDisconnect:
        pass
    except (ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        t1.cancel()
        t2.cancel()
        await asyncio.gather(t1, t2, return_exceptions=True)
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
        await _release_session(user.id)
