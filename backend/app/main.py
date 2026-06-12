from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import auth, problems, submissions
from app.config import get_settings
from app.db import engine
from app.judge import Judge0Judge
from app.judging import JudgeWorker


@asynccontextmanager
async def lifespan(app: FastAPI):
    judge = Judge0Judge(get_settings().judge0_url)
    worker = JudgeWorker(judge)
    app.state.judge = judge  # exécutions d'essai synchrones (run sur exemples)
    app.state.judge_worker = worker
    await worker.start()
    yield
    await worker.stop()


app = FastAPI(title="ClubJudge API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(problems.router)
app.include_router(submissions.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "version": app.version}


@app.get("/api/health/deep")
async def health_deep() -> dict:
    """Liveness of the two services the API depends on. Admin/ops endpoint."""
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
