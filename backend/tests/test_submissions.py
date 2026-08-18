from datetime import UTC, datetime, timedelta

from app import submissions
from app.config import get_settings
from app.judge.types import Verdict
from app.judging import JudgeWorker
from app.models import Submission, SubmissionStatus
from tests.conftest import FakeJudge, register

PYTHON_CODE = "a, b = map(int, input().split())\nprint(a + b)\n"


def submit(client, slug="deux-sommes"):
    return client.post(
        f"/api/problems/{slug}/submissions",
        json={"language": "python", "source_code": PYTHON_CODE},
    )


def _add(db, user_id, problem_id, verdict, created_at):
    db.add(
        Submission(
            user_id=user_id,
            problem_id=problem_id,
            language="python",
            source_code="x",
            status="done",
            verdict=verdict,
            created_at=created_at,
        )
    )
    db.commit()


def test_solved_attempts_counts_up_to_first_ac(client, db, problem):
    me = register(client)
    base = datetime.now(UTC) - timedelta(hours=1)
    _add(db, me["id"], problem.id, "WA", base)
    _add(db, me["id"], problem.id, "WA", base + timedelta(minutes=1))
    _add(db, me["id"], problem.id, "AC", base + timedelta(minutes=2))
    # Une réussite ultérieure ne doit pas gonfler le compte.
    _add(db, me["id"], problem.id, "AC", base + timedelta(minutes=3))

    body = client.get("/api/problems/deux-sommes").json()
    assert body["solved"] is True
    assert body["solved_attempts"] == 3


def test_solved_attempts_excludes_compile_and_internal_errors(client, db, problem):
    # CE (jamais exécuté) et IE (faute du juge) ne sont pas de vraies tentatives :
    # ils ne comptent pas dans « résolu en N essais », comme la pénalité du classement.
    me = register(client)
    base = datetime.now(UTC) - timedelta(hours=1)
    _add(db, me["id"], problem.id, "CE", base)
    _add(db, me["id"], problem.id, "WA", base + timedelta(minutes=1))
    _add(db, me["id"], problem.id, "IE", base + timedelta(minutes=2))
    _add(db, me["id"], problem.id, "AC", base + timedelta(minutes=3))

    body = client.get("/api/problems/deux-sommes").json()
    assert body["solved_attempts"] == 2  # WA + AC ; CE et IE écartés


def test_solved_attempts_excludes_pending(client, db, problem):
    # Une soumission encore en file (non jugée) n'est pas un essai.
    me = register(client)
    base = datetime.now(UTC) - timedelta(hours=1)
    db.add(
        Submission(
            user_id=me["id"],
            problem_id=problem.id,
            language="python",
            source_code="x",
            status=SubmissionStatus.QUEUED,
            verdict=None,
            created_at=base,
        )
    )
    db.commit()
    _add(db, me["id"], problem.id, "AC", base + timedelta(minutes=1))

    body = client.get("/api/problems/deux-sommes").json()
    assert body["solved_attempts"] == 1  # seul l'AC compte


def test_solved_attempts_null_when_unsolved(client, db, problem):
    me = register(client)
    _add(db, me["id"], problem.id, "WA", datetime.now(UTC))
    body = client.get("/api/problems/deux-sommes").json()
    assert body["solved"] is False
    assert body["solved_attempts"] is None


def test_solve_stats_endpoint_matches_problem_detail(client, db, problem):
    me = register(client)
    base = datetime.now(UTC) - timedelta(hours=1)
    _add(db, me["id"], problem.id, "WA", base)
    _add(db, me["id"], problem.id, "AC", base + timedelta(minutes=1))

    body = client.get("/api/problems/deux-sommes/solve-stats").json()
    assert body == {"solved": True, "attempted": True, "solved_attempts": 2}


def test_solve_stats_unattempted(client, problem):
    register(client)
    body = client.get("/api/problems/deux-sommes/solve-stats").json()
    assert body == {"solved": False, "attempted": False, "solved_attempts": None}


def test_solve_stats_unknown_problem_404(client):
    register(client)
    assert client.get("/api/problems/nope/solve-stats").status_code == 404


def test_submission_persisted_and_enqueued(client, db, problem, stub_worker):
    register(client)
    resp = submit(client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == SubmissionStatus.QUEUED
    assert body["verdict"] is None
    assert stub_worker.enqueued == [body["id"]]
    # Persistée en base avant tout passage par le juge.
    assert db.get(Submission, body["id"]) is not None


def test_submission_cooldown(client, problem):
    register(client)
    assert submit(client).status_code == 201
    second = submit(client)
    assert second.status_code == 429
    assert "Retry-After" in second.headers


def test_submission_success_carries_cooldown_header(client, problem):
    register(client)
    resp = submit(client)
    assert resp.status_code == 201
    # Le cooldown configuré accompagne le succès dans un en-tête dédié (Retry-After
    # reste réservé au 429 de rate-limiting) : le client n'a pas à le deviner.
    assert int(resp.headers[submissions.COOLDOWN_HEADER]) == get_settings().submission_cooldown_s
    assert "Retry-After" not in resp.headers


def test_unknown_problem(client, problem):
    register(client)
    assert submit(client, slug="inconnu").status_code == 404


async def test_pipeline_accepted(client, db, problem, stub_worker, session_factory):
    register(client)
    submission_id = submit(client).json()["id"]

    worker = JudgeWorker(FakeJudge(Verdict.ACCEPTED), session_factory=session_factory)
    await worker._judge_one(submission_id)

    resp = client.get(f"/api/submissions/{submission_id}")
    body = resp.json()
    assert body["status"] == SubmissionStatus.DONE
    assert body["verdict"] == Verdict.ACCEPTED
    assert body["failed_test"] is None

    problems = client.get("/api/problems").json()
    assert problems[0]["solved"] is True


async def test_pipeline_wrong_answer_reports_first_failed_test(
    client, db, problem, session_factory
):
    register(client)
    submission_id = submit(client).json()["id"]

    worker = JudgeWorker(FakeJudge(Verdict.WRONG_ANSWER), session_factory=session_factory)
    await worker._judge_one(submission_id)

    body = client.get(f"/api/submissions/{submission_id}").json()
    assert body["verdict"] == Verdict.WRONG_ANSWER
    assert body["failed_test"] == 1

    problems = client.get("/api/problems").json()
    assert problems[0]["solved"] is False
    assert problems[0]["attempted"] is True


def test_submission_isolation(client, db, problem, stub_worker):
    register(client, "alice@example.org")
    submission_id = submit(client).json()["id"]
    client.post("/api/auth/logout")

    register(client, "mallory@example.org")
    assert client.get(f"/api/submissions/{submission_id}").status_code == 404
