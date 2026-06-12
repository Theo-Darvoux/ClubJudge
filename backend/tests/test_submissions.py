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
