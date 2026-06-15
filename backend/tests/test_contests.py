"""Phase 2 : compétitions ICPC — scoring, visibilité, inscriptions, admin."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.contests import compute_scores
from app.judge.types import Verdict
from app.models import (
    Contest,
    ContestProblem,
    ContestRegistration,
    Problem,
    Role,
    Submission,
    SubmissionStatus,
    User,
)
from tests.conftest import register

T0 = datetime(2026, 6, 13, 14, 0, tzinfo=UTC)


def _sub(
    user_id: int,
    problem_id: int,
    minute: int,
    verdict: Verdict | None,
    sub_id: int = 0,
) -> Submission:
    """Soumission en mémoire pour le scoring pur (jamais persistée)."""
    s = Submission(
        user_id=user_id,
        problem_id=problem_id,
        language="python",
        source_code="x",
        status=SubmissionStatus.DONE if verdict else SubmissionStatus.QUEUED,
        verdict=verdict,
    )
    s.id = sub_id
    s.created_at = T0 + timedelta(minutes=minute)
    return s


# ---------------------------------------------------------------------------
# Scoring ICPC pur.


def test_penalty_counts_time_and_rejects():
    # 2 WA puis AC à la minute 30 : pénalité 30 + 2×20 = 70.
    rows = compute_scores(
        T0,
        [1],
        [10],
        [
            _sub(1, 10, 5, Verdict.WRONG_ANSWER, 1),
            _sub(1, 10, 12, Verdict.TIME_LIMIT_EXCEEDED, 2),
            _sub(1, 10, 30, Verdict.ACCEPTED, 3),
            _sub(1, 10, 40, Verdict.WRONG_ANSWER, 4),  # après l'AC : ignorée
        ],
    )
    assert rows[0].solved == 1
    assert rows[0].penalty_min == 70
    assert rows[0].cells[10].tries == 2
    assert rows[0].cells[10].solved_at_min == 30


def test_compile_errors_cost_nothing():
    rows = compute_scores(
        T0,
        [1],
        [10],
        [
            _sub(1, 10, 5, Verdict.COMPILATION_ERROR, 1),
            _sub(1, 10, 9, Verdict.INTERNAL_ERROR, 2),
            _sub(1, 10, 10, Verdict.ACCEPTED, 3),
        ],
    )
    assert rows[0].penalty_min == 10
    assert rows[0].cells[10].tries == 0


def test_unsolved_problem_costs_nothing():
    rows = compute_scores(T0, [1], [10], [_sub(1, 10, 5, Verdict.WRONG_ANSWER, 1)])
    assert rows[0].solved == 0
    assert rows[0].penalty_min == 0
    assert rows[0].cells[10].tries == 1


def test_ranking_solved_then_penalty_then_last_solve():
    submissions = [
        # Alice (1) : 2 résolus, pénalité 10 + 60 = 70.
        _sub(1, 10, 10, Verdict.ACCEPTED, 1),
        _sub(1, 11, 60, Verdict.ACCEPTED, 2),
        # Bob (2) : 2 résolus, pénalité 30 + 35 = 65 → devant Alice.
        _sub(2, 10, 30, Verdict.ACCEPTED, 3),
        _sub(2, 11, 35, Verdict.ACCEPTED, 4),
        # Carol (3) : 1 résolu — derrière malgré une pénalité minuscule.
        _sub(3, 10, 1, Verdict.ACCEPTED, 5),
    ]
    rows = compute_scores(T0, [1, 2, 3], [10, 11], submissions)
    assert [r.user_id for r in rows] == [2, 1, 3]


def test_first_blood_goes_to_earliest_ac():
    rows = compute_scores(
        T0,
        [1, 2],
        [10],
        [_sub(2, 10, 7, Verdict.ACCEPTED, 1), _sub(1, 10, 9, Verdict.ACCEPTED, 2)],
    )
    by_user = {r.user_id: r for r in rows}
    assert by_user[2].cells[10].first_blood
    assert not by_user[1].cells[10].first_blood


def test_pending_submission_flagged_not_counted():
    rows = compute_scores(T0, [1], [10], [_sub(1, 10, 5, None, 1)])
    assert rows[0].cells[10].pending
    assert rows[0].cells[10].tries == 0


# ---------------------------------------------------------------------------
# Helpers API.


def make_admin(client, db, email="admin@example.org") -> dict:
    out = register(client, email)
    user = db.scalar(select(User).where(User.email == email))
    user.role = Role.ADMIN
    db.commit()
    return out


def make_contest(
    db,
    problem: Problem,
    *,
    start_in_min: int,
    end_in_min: int,
    slug: str = "contest-test",
) -> Contest:
    now = datetime.now(UTC)
    contest = Contest(
        slug=slug,
        title="Contest de test",
        start_at=now + timedelta(minutes=start_in_min),
        end_at=now + timedelta(minutes=end_in_min),
        problems=[ContestProblem(problem_id=problem.id, label="A")],
    )
    db.add(contest)
    db.commit()
    return contest


def register_to(db, contest: Contest, user_email: str):
    user = db.scalar(select(User).where(User.email == user_email))
    db.add(ContestRegistration(contest_id=contest.id, user_id=user.id))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# Visibilité des problèmes de contest.


def test_contest_problem_hidden_until_finished(client, db, problem):
    register(client)
    make_contest(db, problem, start_in_min=-30, end_in_min=30)

    slugs = [p["slug"] for p in client.get("/api/problems").json()]
    assert problem.slug not in slugs
    assert client.get(f"/api/problems/{problem.slug}").status_code == 404
    assert (
        client.post(
            f"/api/problems/{problem.slug}/submissions",
            json={"language": "python", "source_code": "print(5)"},
        ).status_code
        == 404
    )


def test_contest_problem_visible_to_registered_during_window(client, db, problem):
    register(client)
    contest = make_contest(db, problem, start_in_min=-30, end_in_min=30)
    register_to(db, contest, "alice@example.org")

    detail = client.get(f"/api/problems/{problem.slug}").json()
    assert detail["contest"] == {
        "slug": "contest-test",
        "title": "Contest de test",
        "label": "A",
        "end_at": detail["contest"]["end_at"],
    }
    # Conditions ICPC : pas d'indices ni d'éditorial pendant la fenêtre.
    assert detail["hints"] == []
    assert detail["has_editorial"] is False


def test_contest_problem_public_after_end(client, db, problem):
    register(client)
    make_contest(db, problem, start_in_min=-120, end_in_min=-60)

    slugs = [p["slug"] for p in client.get("/api/problems").json()]
    assert problem.slug in slugs
    detail = client.get(f"/api/problems/{problem.slug}").json()
    assert detail["contest"] is None


def test_contest_problem_with_multiple_future_contests(client, db, problem):
    register(client, "alice@example.org")
    contest1 = make_contest(db, problem, start_in_min=-30, end_in_min=30, slug="contest-running")
    register_to(db, contest1, "alice@example.org")
    make_contest(db, problem, start_in_min=60, end_in_min=120, slug="contest-upcoming")

    detail = client.get(f"/api/problems/{problem.slug}").json()
    assert detail["contest"]["slug"] == "contest-running"


def test_solutions_locked_during_contest(client, db, problem):
    register(client)
    contest = make_contest(db, problem, start_in_min=-30, end_in_min=30)
    user = register_to(db, contest, "alice@example.org")
    db.add(
        Submission(
            user_id=user.id,
            problem_id=problem.id,
            language="python",
            source_code="x",
            status=SubmissionStatus.DONE,
            verdict=Verdict.ACCEPTED,
        )
    )
    db.commit()

    resp = client.get(f"/api/problems/{problem.slug}/solutions")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "contest_running"


def test_submission_attached_to_running_contest(client, db, problem, stub_worker):
    register(client)
    contest = make_contest(db, problem, start_in_min=-30, end_in_min=30)
    register_to(db, contest, "alice@example.org")

    resp = client.post(
        f"/api/problems/{problem.slug}/submissions",
        json={"language": "python", "source_code": "print(5)"},
    )
    assert resp.status_code == 201
    submission = db.get(Submission, resp.json()["id"])
    assert submission.contest_id == contest.id
    assert stub_worker.enqueued == [submission.id]


# ---------------------------------------------------------------------------
# Inscription.


def test_register_and_unregister_before_start(client, db, problem):
    register(client)
    make_contest(db, problem, start_in_min=60, end_in_min=120)

    assert client.post("/api/contests/contest-test/register").status_code == 204
    assert client.get("/api/contests/contest-test").json()["registered"] is True
    assert client.delete("/api/contests/contest-test/register").status_code == 204
    assert client.get("/api/contests/contest-test").json()["registered"] is False


def test_no_unregister_after_start_no_register_after_end(client, db, problem):
    register(client)
    make_contest(db, problem, start_in_min=-30, end_in_min=30)
    assert client.post("/api/contests/contest-test/register").status_code == 204
    assert client.delete("/api/contests/contest-test/register").status_code == 409

    make_contest(db, problem, start_in_min=-120, end_in_min=-60, slug="fini")
    assert client.post("/api/contests/fini/register").status_code == 409


def test_problem_list_hidden_from_unregistered_detail(client, db, problem):
    register(client)
    make_contest(db, problem, start_in_min=-30, end_in_min=30)
    detail = client.get("/api/contests/contest-test").json()
    assert detail["phase"] == "running"
    assert detail["problems"] is None  # non inscrit : énoncés cachés
    assert detail["problem_count"] == 1


# ---------------------------------------------------------------------------
# Scoreboard.


def test_scoreboard_409_before_start(client, db, problem):
    register(client)
    make_contest(db, problem, start_in_min=60, end_in_min=120)
    assert client.get("/api/contests/contest-test/scoreboard").status_code == 409


def test_scoreboard_rows_and_ranks(client, db, problem):
    register(client)
    register(client, "bob@example.org")
    contest = make_contest(db, problem, start_in_min=-60, end_in_min=60)
    alice = register_to(db, contest, "alice@example.org")
    bob = register_to(db, contest, "bob@example.org")

    start = contest.start_at.replace(tzinfo=UTC)
    for user, minute, verdict in [
        (alice, 10, Verdict.WRONG_ANSWER),
        (alice, 20, Verdict.ACCEPTED),
        (bob, 30, Verdict.ACCEPTED),
    ]:
        s = Submission(
            user_id=user.id,
            problem_id=problem.id,
            contest_id=contest.id,
            language="python",
            source_code="x",
            status=SubmissionStatus.DONE,
            verdict=verdict,
        )
        s.created_at = start + timedelta(minutes=minute)
        db.add(s)
    db.commit()

    board = client.get("/api/contests/contest-test/scoreboard").json()
    assert board["problems"] == ["A"]
    first, second = board["rows"]
    # Bob : AC direct à la minute 30 → pénalité 30, premier.
    assert (first["solved"], first["penalty_min"], first["rank"]) == (1, 30, 1)
    assert first["cells"][0]["first_blood"] is False
    # Alice : 1 WA + AC à la minute 20 → pénalité 40, mais first blood.
    assert (second["solved"], second["penalty_min"], second["rank"]) == (1, 40, 2)
    assert second["cells"][0]["first_blood"] is True
    assert second["cells"][0]["tries"] == 1


# ---------------------------------------------------------------------------
# Admin : CRUD contest et rejudge.


def test_create_contest_requires_admin(client, db, problem):
    register(client)
    resp = client.post(
        "/api/contests",
        json={
            "slug": "x",
            "title": "X",
            "start_at": "2026-07-01T18:00:00+00:00",
            "end_at": "2026-07-01T21:00:00+00:00",
            "problems": [],
        },
    )
    assert resp.status_code == 403


def test_admin_creates_contest(client, db, problem):
    make_admin(client, db)
    resp = client.post(
        "/api/contests",
        json={
            "slug": "contest-rentree",
            "title": "Contest de rentrée",
            "description": "Premier contest du semestre.",
            "start_at": "2026-07-01T18:00:00+00:00",
            "end_at": "2026-07-01T21:00:00+00:00",
            "problems": [{"slug": problem.slug, "label": "A"}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["phase"] == "upcoming"
    assert body["problem_count"] == 1

    listing = client.get("/api/contests").json()
    assert [c["slug"] for c in listing] == ["contest-rentree"]


def test_create_contest_rejects_bad_payloads(client, db, problem):
    make_admin(client, db)
    base = {
        "slug": "c",
        "title": "C",
        "start_at": "2026-07-01T18:00:00+00:00",
        "end_at": "2026-07-01T21:00:00+00:00",
        "problems": [],
    }
    cases = [
        {**base, "end_at": "2026-07-01T17:00:00+00:00"},  # fin avant début
        {**base, "start_at": "2026-07-01T18:00:00"},  # datetime naïf
        {**base, "slug": "Pas Un Slug"},
        {**base, "problems": [{"slug": "inconnu", "label": "A"}]},
        {**base, "problems": [{"slug": problem.slug, "label": "a"}]},  # label invalide
        {
            **base,
            "problems": [
                {"slug": problem.slug, "label": "A"},
                {"slug": problem.slug, "label": "B"},  # problème en double
            ],
        },
    ]
    for payload in cases:
        assert client.post("/api/contests", json=payload).status_code == 422, payload


def test_delete_contest_only_before_start(client, db, problem):
    make_admin(client, db)
    make_contest(db, problem, start_in_min=-30, end_in_min=30)
    assert client.delete("/api/contests/contest-test").status_code == 409
    make_contest(db, problem, start_in_min=30, end_in_min=90, slug="a-venir")
    assert client.delete("/api/contests/a-venir").status_code == 204


def test_rejudge_problem_resets_and_enqueues(client, db, problem, stub_worker):
    make_admin(client, db)
    s = Submission(
        user_id=db.scalar(select(User.id)),
        problem_id=problem.id,
        language="python",
        source_code="x",
        status=SubmissionStatus.DONE,
        verdict=Verdict.WRONG_ANSWER,
        failed_test=2,
    )
    db.add(s)
    db.commit()

    resp = client.post(f"/api/admin/problems/{problem.slug}/rejudge")
    assert resp.status_code == 200
    assert resp.json() == {"rejudged": 1}
    db.refresh(s)
    assert s.status == SubmissionStatus.QUEUED
    assert s.verdict is None
    assert s.failed_test is None
    assert stub_worker.enqueued == [s.id]


def test_rejudge_requires_admin(client, db, problem):
    register(client)
    assert client.post(f"/api/admin/problems/{problem.slug}/rejudge").status_code == 403
    assert client.post("/api/admin/submissions/1/rejudge").status_code == 403
