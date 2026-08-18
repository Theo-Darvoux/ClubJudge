"""Indices, éditorial et solutions des autres — déblocage après son propre AC."""

from app.models import Submission
from tests.conftest import register


def _add_ac(
    db, user_id: int, problem_id: int, *, language="python", time_s=0.05, source="print(5)"
) -> None:
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

    # Une entrée par (membre, langage), la plus rapide, triées par temps. Le
    # percentile n'est renseigné que pour ses PROPRES solutions (cf. ci-dessous) :
    # ici Alice ne le voit que sur sa ligne, None sur celles de Bob.
    assert [(s["author"], s["language"], s["source_code"], s["percentile"]) for s in body] == [
        ("Bob", "cpp", "int main(){}", None),
        ("Bob", "python", "rapide", None),
        ("Alice", "python", "print(5)", 0),
    ]
    assert [s["is_mine"] for s in body] == [False, False, True]


def test_percentile_only_computed_for_own_solutions(client, db, problem):
    """« Plus rapide que X % » est calculé sur tous les résolveurs (le classement),
    mais n'est renvoyé que pour les lignes de l'appelant — jamais pour celles des
    autres, que le client n'affiche pas."""
    me = register(client)
    other = register(client, email="bob@example.org")

    # Bob est le plus rapide en Python : sur sa propre vue, il doit donc voir un
    # percentile élevé (plus rapide qu'Alice), et None sur la ligne d'Alice.
    _add_ac(db, me["id"], problem.id, time_s=0.08)
    _add_ac(db, other["id"], problem.id, time_s=0.02, source="rapide")

    # `register` a connecté Bob en dernier : on reste donc Bob.
    body = client.get("/api/problems/deux-sommes/solutions").json()
    by_author = {s["author"]: s for s in body}

    assert by_author["Bob"]["is_mine"] is True
    assert by_author["Bob"]["percentile"] == 100  # plus rapide que l'unique autre
    assert by_author["Alice"]["is_mine"] is False
    assert by_author["Alice"]["percentile"] is None  # jamais exposé pour autrui
