"""Indices, éditorial et solutions des autres — déblocage après son propre AC."""

from app.models import Submission
from tests.conftest import register


def _add_ac(db, user_id: int, problem_id: int, *, language="python", time_s=0.05,
            source="print(5)") -> None:
    db.add(
        Submission(
            user_id=user_id,
            problem_id=problem_id,
            language=language,
            source_code=source,
            status="done",
            verdict="AC",
            time_s=time_s,
            memory_kb=1024,
        )
    )
    db.commit()


def test_detail_exposes_samples_hints_and_editorial_flag(client, db, problem):
    problem.editorial_fr = "On additionne."
    db.commit()
    register(client)
    body = client.get("/api/problems/deux-sommes").json()
    assert body["samples"] == [{"input": "2 3\n", "expected_output": "5\n"}]
    assert body["has_editorial"] is True
    assert body["hints"] == []


def test_editorial_requires_own_ac(client, db, problem):
    problem.editorial_fr = "On additionne."
    db.commit()
    me = register(client)

    locked = client.get("/api/problems/deux-sommes/editorial")
    assert locked.status_code == 403
    assert locked.json()["detail"] == "solve_first"

    _add_ac(db, me["id"], problem.id)
    unlocked = client.get("/api/problems/deux-sommes/editorial")
    assert unlocked.status_code == 200
    assert unlocked.json()["editorial_fr"] == "On additionne."


def test_editorial_404_when_problem_has_none(client, db, problem):
    me = register(client)
    _add_ac(db, me["id"], problem.id)
    assert client.get("/api/problems/deux-sommes/editorial").status_code == 404


def test_solutions_require_own_ac(client, problem):
    register(client)
    resp = client.get("/api/problems/deux-sommes/solutions")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "solve_first"


def test_solutions_keep_best_per_member_and_language(client, db, problem):
    me = register(client)
    other = register(client, email="bob@example.org")

    _add_ac(db, me["id"], problem.id, time_s=0.08)
    _add_ac(db, other["id"], problem.id, time_s=0.10, source="lent")
    _add_ac(db, other["id"], problem.id, time_s=0.02, source="rapide")
    _add_ac(db, other["id"], problem.id, language="cpp", time_s=0.01, source="int main(){}")

    # `register` connecte le dernier inscrit : on se reconnecte en tant qu'Alice.
    client.post(
        "/api/auth/login",
        json={"email": "alice@example.org", "password": "correct-horse"},
    )
    body = client.get("/api/problems/deux-sommes/solutions").json()

    # Une entrée par (membre, langage), la plus rapide, triées par temps.
    assert [(s["author"], s["language"], s["source_code"]) for s in body] == [
        ("Alice", "cpp", "int main(){}"),
        ("Alice", "python", "rapide"),
        ("Alice", "python", "print(5)"),
    ]
    assert [s["is_mine"] for s in body] == [False, False, True]
