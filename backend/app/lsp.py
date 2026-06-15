"""Pont WebSocket ↔ clangd pour l'IntelliSense C/C++ de l'éditeur.

clangd parle le Language Server Protocol sur stdin/stdout, avec un cadrage par
en-tête « Content-Length » (comme HTTP). Côté navigateur on ne veut pas de ce
cadrage : on échange **un message JSON-RPC par trame WebSocket**. Ce module fait
donc la traduction dans les deux sens et lance un processus clangd par session.

clangd ne fait qu'analyser le code (complétion, survol, diagnostics) : il
n'exécute rien. L'exécution réelle reste du ressort de Judge0.
"""

import asyncio
import shutil
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, _token_hash
from app.db import as_utc, get_db
from app.models import User, UserSession

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

    if _authenticate(websocket, db) is None:
        await websocket.close(code=1008, reason="unauthenticated")
        return

    binary, args = server
    binary_path = shutil.which(binary)
    if binary_path is None:
        # Serveur de langage absent (ex. dév sur l'hôte) : on ferme proprement, le
        # client retombe sur l'auto-complétion statique.
        await websocket.accept()
        await websocket.close(code=1011, reason="server_unavailable")
        return

    await websocket.accept()

    process = await asyncio.create_subprocess_exec(
        binary_path,
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    assert process.stdin is not None and process.stdout is not None
    stdin, stdout = process.stdin, process.stdout

    async def browser_to_server() -> None:
        while True:
            message = await websocket.receive_text()
            if len(message) > MAX_MESSAGE_BYTES:
                continue  # on ignore les trames anormalement grosses
            stdin.write(_frame(message))
            await stdin.drain()

    async def server_to_browser() -> None:
        while True:
            message = await _read_message(stdout)
            if message is None:
                return
            await websocket.send_text(message)

    pump = asyncio.gather(browser_to_server(), server_to_browser())
    try:
        await pump
    except WebSocketDisconnect:
        pass
    except (ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        pump.cancel()
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except TimeoutError:
                process.kill()
