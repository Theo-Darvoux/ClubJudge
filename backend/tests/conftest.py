import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.judge.base import Judge
from app.judge.types import JudgeResult, Language, TestCase, TestVerdict, Verdict
from app.main import app
from app.models import Problem, ProblemTest
from app.submissions import get_worker


class FakeJudge(Judge):
    """Juge déterministe pour les tests : verdict fixé à la construction."""

    def __init__(self, verdict: Verdict = Verdict.ACCEPTED):
        self.verdict = verdict
        self.calls: list[str] = []

    async def submit(
        self,
        source_code: str,
        language: Language,
        tests: list[TestCase],
        *,
        time_limit_s: float = 2.0,
        memory_limit_kb: int = 262_144,
    ) -> JudgeResult:
        self.calls.append(source_code)
        per_test = [
            TestVerdict(verdict=self.verdict, time_s=0.01, memory_kb=1024) for _ in tests
        ]
        return JudgeResult(verdict=self.verdict, tests=per_test)


class StubWorker:
    """Capture les enqueues sans rien juger — le jugement est testé à part."""

    def __init__(self):
        self.enqueued: list[int] = []

    def enqueue(self, submission_id: int) -> None:
        self.enqueued.append(submission_id)


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def db(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture
def stub_worker():
    return StubWorker()


@pytest.fixture
def client(session_factory, stub_worker):
    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_worker] = lambda: stub_worker
    # Pas de `with` : on évite le lifespan (worker réel) en tests unitaires.
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def problem(db) -> Problem:
    problem = Problem(
        slug="deux-sommes",
        title="Deux sommes",
        category="bases",
        difficulty=1,
        statement_fr="Calculez $a+b$.",
        tests=[
            ProblemTest(position=1, input="2 3\n", expected_output="5\n"),
            ProblemTest(position=2, input="40 2\n", expected_output="42\n"),
        ],
    )
    db.add(problem)
    db.commit()
    return problem


def register(client: TestClient, email: str = "alice@example.org") -> dict:
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "correct-horse", "display_name": "Alice"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
