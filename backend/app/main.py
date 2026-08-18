from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.responses import JSONResponse

from app import admin, auth, contests, courses, lsp, problems, skills, submissions
from app.config import get_settings
from app.db import engine
from app.judge import Judge0Judge
from app.judging import JudgeWorker
from app.notify import ContestAnnouncer
from app.security import origin_allowed


@asynccontextmanager
async def lifespan(app: FastAPI):
    judge = Judge0Judge(get_settings().judge0_url)
    worker = JudgeWorker(judge)
    announcer = ContestAnnouncer()
    app.state.judge = judge  # exécutions d'essai synchrones (run sur exemples)
    app.state.judge_worker = worker
    await worker.start()
    await announcer.start()
    yield
    await announcer.stop()
    await worker.stop()


app = FastAPI(title="ClubJudge API", version="0.1.0", lifespan=lifespan)

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@app.middleware("http")
async def reject_cross_site_unsafe_requests(request: Request, call_next):
    """CSRF defense for the cookie-authenticated API.

    SameSite=Lax already blocks most cross-site cookie sends; validating Origin
    on state-changing browser requests closes the remaining gap without requiring
    a JS-readable CSRF token. Requests without Origin (CLI/health tooling) remain
    accepted.
    """
    if request.method in _UNSAFE_METHODS:
        forwarded_proto = request.headers.get("x-forwarded-proto")
        scheme = (
            forwarded_proto.split(",", 1)[0].strip()
            if forwarded_proto
            else request.url.scheme
        )
        if not origin_allowed(
            request.headers.get("origin"),
            host=request.headers.get("host", ""),
            scheme=scheme,
            allowed_origins=get_settings().cors_origins,
        ):
            return JSONResponse(status_code=403, content={"detail": "bad_origin"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # En-têtes de réponse que le JS du navigateur peut lire en cross-origin. Sans
    # cela, un en-tête non « safelisté » comme le cooldown (ou Retry-After) reste
    # invisible côté client une fois le frontend servi depuis une autre origine.
    expose_headers=[submissions.COOLDOWN_HEADER, "Retry-After"],
)

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(contests.router)
app.include_router(courses.router)
app.include_router(lsp.router)
app.include_router(problems.router)
app.include_router(skills.router)
app.include_router(submissions.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": app.version}


@app.get("/api/health/deep")
async def health_deep(_admin: auth.AdminUser) -> dict:
    """Dependency health for authenticated administrators only."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "down"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{get_settings().judge0_url}/workers")
            judge0 = "ok" if resp.status_code == 200 else "down"
    except httpx.HTTPError:
        judge0 = "down"

    return {
        "database": database,
        "judge0": judge0,
        "judge_queue_length": app.state.judge_worker.queue_length,
    }
