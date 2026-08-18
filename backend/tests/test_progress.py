"""Agrégation de progression : solved_attempted_ids, avec restriction optionnelle
au sous-ensemble de problèmes demandé (le détail d'un contest ne paie pas le scan
de tout l'historique de soumissions du membre)."""

from app.judge.types import Verdict
from app.models import Problem, Submission, SubmissionStatus, User
from app.progress import solved_attempted_ids


def _user(db) -> User:
    user = User(email="u@example.org", display_name="U", password_hash="x")
    db.add(user)
    db.commit()
    return user


def _solve(db, user_id: int, problem_id: int, verdict: Verdict) -> None:
    db.add(
        Submission(
            user_id=user_id,
            problem_id=problem_id,
            language="python",
            source_code="x",
            status=SubmissionStatus.DONE,
            verdict=verdict,
        )
    )
    db.commit()


def test_solved_attempted_ids_filters_to_requested_problems(db, problem):
    user = _user(db)
    second = Problem(
        slug="autre", title="Autre", category="bases", difficulty=1, statement_fr="x"
    )
    db.add(second)
    db.commit()

    _solve(db, user.id, problem.id, Verdict.ACCEPTED)
    _solve(db, user.id, second.id, Verdict.WRONG_ANSWER)

    # Sans filtre : tout l'historique.
    assert solved_attempted_ids(db, user.id) == ({problem.id}, {problem.id, second.id})

    # Restreint au seul problème résolu : l'autre disparaît des deux ensembles.
    assert solved_attempted_ids(db, user.id, [problem.id]) == ({problem.id}, {problem.id})

    # Collection vide ⇒ rien (pas de scan, pas de `IN ()` ambigu).
    assert solved_attempted_ids(db, user.id, []) == (set(), set())
