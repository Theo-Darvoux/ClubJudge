"""Seed un contest de démonstration « à l'échelle » : tous les problèmes + une
centaine de faux participants, pour visualiser le scoreboard ICPC tel qu'il se
comporte avec beaucoup de monde (en-tête collant, bloc identité gelé, filtre,
barre « ma place »).

Le contest est créé **terminé** (fenêtre dans le passé) : les problèmes ne sont
donc pas cachés de la liste générale, et le scoreboard est le classement final
— rien n'est perturbé sur le site en cours d'usage.

Tout est réversible :

    python scripts/seed_demo_contest.py            # crée / recrée la démo
    python scripts/seed_demo_contest.py --teardown # supprime tout (faux comptes,
                                                    # inscriptions, soumissions)

Les vrais comptes existants sont inscrits eux aussi, pour que la ligne « VOUS »
et la barre « ma place » s'affichent quel que soit le compte connecté. Le
teardown efface les soumissions de démo, donc la progression réelle revient à
son état initial.
"""

import argparse
import random
import sys
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from sqlalchemy import delete, select

from app.db import SessionLocal
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
from app.judge.types import Language, Verdict

SLUG = "demo-passage-a-lechelle"
TITLE = "Démo — passage à l'échelle"
DESCRIPTION = (
    "Contest de démonstration généré pour visualiser le scoreboard avec beaucoup "
    "de participants. Comptes et soumissions fictifs."
)
FAKE_EMAIL_DOMAIN = "demo-scale.clubjudge.local"
N_FAKE_USERS = 100
WINDOW_MIN = 120  # durée de la fenêtre (minutes)

FIRST_NAMES = [
    "lea", "hugo", "ines", "noah", "jade", "liam", "emma", "tom", "chloe", "nael",
    "lina", "adam", "mila", "sacha", "anna", "raph", "zoe", "lucas", "rose", "ethan",
    "manon", "gabin", "lou", "marius", "nina", "axel", "elsa", "remy", "iris", "yanis",
    "alba", "theo", "juno", "kai", "maya", "elio", "suki", "milo", "olya", "tariq",
]
HANDLES = [
    "segfault", "0x1f", "kawai", "nullptr", "ackermann", "binary", "modulo", "heapsort",
    "greedy", "dp", "trie", "bitset", "kmp", "dijkstra", "fenwick", "mst", "scc",
    "rabin", "euler", "fermat", "lambda", "monad", "ssr", "async", "vector", "deque",
    "rng", "xor", "gcd", "primes", "matrix", "graph", "stack", "queue", "tree",
]


def _make_names(n: int, rng: random.Random) -> list[str]:
    """n pseudos distincts façon handles de club (`lea_segfault`, `hugo_dp42`…)."""
    seen: set[str] = set()
    names: list[str] = []
    while len(names) < n:
        base = f"{rng.choice(FIRST_NAMES)}_{rng.choice(HANDLES)}"
        name = base if base not in seen else f"{base}{rng.randint(2, 99)}"
        if name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def teardown(db) -> None:
    contest = db.scalar(select(Contest).where(Contest.slug == SLUG))
    if contest is not None:
        # Effacer d'abord les soumissions de démo : le FK est ON DELETE SET NULL,
        # sinon elles survivraient (orphelines) et pollueraient la progression.
        db.execute(delete(Submission).where(Submission.contest_id == contest.id))
        db.delete(contest)  # cascade → contest_problems + inscriptions
    fakes = list(
        db.scalars(select(User).where(User.email.like(f"%@{FAKE_EMAIL_DOMAIN}")))
    )
    for u in fakes:
        db.execute(delete(Submission).where(Submission.user_id == u.id))
        db.delete(u)
    db.commit()
    print(f"Teardown : contest supprimé, {len(fakes)} faux comptes retirés.")


def seed(db) -> None:
    rng = random.Random(20260616)
    now = datetime.now(UTC)
    start = now - timedelta(minutes=WINDOW_MIN + 30)
    end = now - timedelta(minutes=30)

    teardown(db)  # repart d'une base propre, ré-exécutable

    problems = list(db.scalars(select(Problem).order_by(Problem.difficulty, Problem.id)))
    if not problems:
        print("Aucun problème en base — rien à mettre dans le contest.", file=sys.stderr)
        raise SystemExit(1)
    labels = [chr(ord("A") + i) for i in range(len(problems))]

    contest = Contest(
        slug=SLUG,
        title=TITLE,
        description=DESCRIPTION,
        start_at=start,
        end_at=end,
        start_announced=True,
        results_announced=True,
        problems=[
            ContestProblem(problem_id=p.id, label=label)
            for p, label in zip(problems, labels, strict=True)
        ],
    )
    db.add(contest)
    db.flush()  # contest.id

    # Faux comptes (hash argon2 calculé une seule fois, réutilisé).
    pw = PasswordHasher().hash("demo-password")
    names = _make_names(N_FAKE_USERS, rng)
    fakes = [
        User(
            email=f"demo-{i:03d}@{FAKE_EMAIL_DOMAIN}",
            password_hash=pw,
            display_name=name,
            role=Role.MEMBER,
        )
        for i, name in enumerate(names)
    ]
    db.add_all(fakes)
    db.flush()

    # On inscrit aussi les vrais comptes pour que « VOUS » / la barre « ma place »
    # s'affichent quel que soit le compte connecté. Les « psders » (le compte
    # humain) reçoivent un niveau moyen → placés en milieu de tableau.
    reals = list(db.scalars(select(User).where(~User.email.like(f"%@{FAKE_EMAIL_DOMAIN}"))))

    participants: list[tuple[User, float]] = []
    for u in fakes:
        # Compétences biaisées vers le bas : quelques cracks, beaucoup de modestes.
        participants.append((u, rng.random() ** 1.6))
    for u in reals:
        skill = 0.55 if u.display_name.lower() == "psders" else rng.random() ** 1.8
        participants.append((u, skill))

    registrations = [
        ContestRegistration(contest_id=contest.id, user_id=u.id) for u, _ in participants
    ]
    db.add_all(registrations)

    subs: list[Submission] = []
    for user, skill in participants:
        for pidx, problem in enumerate(problems):
            d = problem.difficulty  # 1..3
            edge = (d - 1) / 3.0
            p_solve = _clamp01((skill - edge) * 1.7 + 0.15)
            solved = rng.random() < p_solve

            if solved:
                # minute du AC : plus tôt si fort, plus tard si dur.
                minute = int((1 - skill) * 55 + d * 6 + rng.uniform(0, 35))
                minute = max(1, min(WINDOW_MIN - 1, minute))
                wrong = rng.choices([0, 1, 2, 3], weights=[55, 28, 12, 5])[0]
                wrong_minutes = sorted(
                    {max(0, minute - rng.randint(1, 8)) for _ in range(wrong)}
                )
                for wm in wrong_minutes:
                    subs.append(_sub(user, problem, contest.id, start, wm, Verdict.WRONG_ANSWER))
                subs.append(_sub(user, problem, contest.id, start, minute, Verdict.ACCEPTED))
            elif rng.random() < skill * 0.6:
                # Tenté sans succès : 1 à 3 soumissions ratées (cellule « −N »).
                for _ in range(rng.randint(1, 3)):
                    wm = rng.randint(1, WINDOW_MIN - 1)
                    verdict = rng.choice(
                        [Verdict.WRONG_ANSWER, Verdict.WRONG_ANSWER, Verdict.TIME_LIMIT_EXCEEDED]
                    )
                    subs.append(_sub(user, problem, contest.id, start, wm, verdict))

    db.add_all(subs)
    db.commit()

    print(f"OK : contest « {TITLE} » ({SLUG}) créé — terminé.")
    print(f"  {len(problems)} problèmes (A–{labels[-1]}), {len(participants)} participants, "
          f"{len(subs)} soumissions.")
    print(f"  À voir sur : /contests/{SLUG}")


def _sub(
    user: User, problem: Problem, contest_id: int, start: datetime, minute: int, verdict: Verdict
) -> Submission:
    created = start + timedelta(minutes=minute, seconds=random.randint(0, 59))
    return Submission(
        user_id=user.id,
        problem_id=problem.id,
        contest_id=contest_id,
        language=Language.PYTHON,
        source_code="# soumission de démonstration\n",
        status=SubmissionStatus.DONE,
        verdict=verdict,
        time_s=0.02,
        memory_kb=12000,
        created_at=created,
        judged_at=created,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--teardown", action="store_true", help="supprimer la démo au lieu de la créer"
    )
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.teardown:
            teardown(db)
        else:
            seed(db)


if __name__ == "__main__":
    main()
