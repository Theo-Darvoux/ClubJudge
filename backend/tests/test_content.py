from pathlib import Path

import pytest

from app.content.importer import upsert_problem, validate_solutions
from app.content.loader import ContentError, load_problem
from app.judge.types import Verdict
from app.models import Problem
from tests.conftest import FakeJudge

CONTENT_DIR = Path(__file__).parent.parent.parent / "content"


def write_valid_problem(root: Path) -> Path:
    d = root / "somme-test"
    (d / "tests").mkdir(parents=True)
    (d / "solutions").mkdir()
    (d / "problem.yaml").write_text(
        "title: Somme\ncategory: bases\ndifficulty: 1\ntags: [io]\n"
    )
    (d / "statement.fr.md").write_text("Énoncé.")
    (d / "tests" / "sample1.in").write_text("2 3\n")
    (d / "tests" / "sample1.out").write_text("5\n")
    (d / "tests" / "02.in").write_text("1 1\n")
    (d / "tests" / "02.out").write_text("2\n")
    (d / "solutions" / "solution.py").write_text("a,b=map(int,input().split());print(a+b)\n")
    (d / "hints.yaml").write_text('- "Lisez deux entiers."\n- "Additionnez-les."\n')
    (d / "editorial.fr.md").write_text("On additionne, tout simplement.\n")
    return d


def test_load_valid_problem(tmp_path):
    loaded = load_problem(write_valid_problem(tmp_path))
    assert loaded.slug == "somme-test"
    assert loaded.difficulty == 1
    assert len(loaded.tests) == 2
    assert loaded.sample_count == 1
    assert loaded.tests[0].input == "2 3\n"  # l'exemple passe en premier
    assert loaded.hints == ["Lisez deux entiers.", "Additionnez-les."]
    assert loaded.editorial_fr is not None
    assert loaded.solutions[0].language == "python"


@pytest.mark.parametrize(
    ("mutate", "fragment"),
    [
        (lambda d: (d / "problem.yaml").unlink(), "problem.yaml"),
        (lambda d: (d / "statement.fr.md").unlink(), "statement.fr.md"),
        (lambda d: (d / "tests" / "02.in").unlink(), "tests"),
        (
            lambda d: (
                (d / "tests" / "sample1.in").rename(d / "tests" / "01.in"),
                (d / "tests" / "sample1.out").rename(d / "tests" / "01.out"),
            ),
            "exemple",
        ),
        (lambda d: (d / "hints.yaml").write_text("pas: une liste\n"), "hints.yaml"),
        (lambda d: (d / "solutions" / "solution.py").unlink(), "solution"),
        (
            lambda d: (d / "problem.yaml").write_text(
                "title: X\ncategory: y\ndifficulty: 12\n"
            ),
            "difficulty",
        ),
    ],
)
def test_load_rejects_broken_problem(tmp_path, mutate, fragment):
    d = write_valid_problem(tmp_path)
    mutate(d)
    with pytest.raises(ContentError) as exc:
        load_problem(d)
    assert fragment in str(exc.value)


async def test_reference_solution_must_pass(tmp_path):
    loaded = load_problem(write_valid_problem(tmp_path))
    await validate_solutions(loaded, FakeJudge(Verdict.ACCEPTED))  # ne lève pas
    with pytest.raises(ContentError, match="WA"):
        await validate_solutions(loaded, FakeJudge(Verdict.WRONG_ANSWER))


def test_upsert_is_idempotent(tmp_path, db):
    loaded = load_problem(write_valid_problem(tmp_path))
    upsert_problem(db, loaded)
    loaded.title = "Somme (v2)"
    upsert_problem(db, loaded)

    problems = db.query(Problem).all()
    assert len(problems) == 1
    assert problems[0].title == "Somme (v2)"
    assert len(problems[0].tests) == 2
    assert problems[0].tests[0].is_sample is True
    assert problems[0].tests[1].is_sample is False
    assert [h.content_fr for h in problems[0].hints] == [
        "Lisez deux entiers.",
        "Additionnez-les.",
    ]
    assert problems[0].editorial_fr is not None


def test_repo_content_format_is_valid():
    """Le contenu réel du dépôt doit toujours passer la validation de format."""
    problems_dir = CONTENT_DIR / "problems"
    slugs = [p.name for p in problems_dir.iterdir() if p.is_dir()]
    assert len(slugs) >= 3
    for slug in slugs:
        load_problem(problems_dir / slug)
