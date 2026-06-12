from pathlib import Path

import pytest

from app.content.importer import sync_skills
from app.content.loader import (
    ContentError,
    default_mastery,
    discover_problems,
    load_skills,
)
from app.models import Problem, ProblemTest, Skill, Submission
from tests.conftest import register

CONTENT_DIR = Path(__file__).parent.parent.parent / "content"

VALID_SKILLS_YAML = """\
skills:
  - id: premiers-pas
    name: Premiers pas
    name_en: First steps
    description: Lire l'entrée, écrire la sortie.
    position: [0, 0]
    problems: [deux-sommes]
  - id: tableaux
    name: Tableaux
    requires: [premiers-pas]
    position: [120, -60]
    problems: [tri-de-dossards, la-meilleure-semaine]
    mastery: 1
"""

SLUGS = {"deux-sommes", "tri-de-dossards", "la-meilleure-semaine"}


def write_skills(root: Path, text: str = VALID_SKILLS_YAML) -> Path:
    (root / "skills.yaml").write_text(text)
    return root


def test_load_valid_skills(tmp_path):
    skills = load_skills(write_skills(tmp_path), SLUGS)
    assert [s.id for s in skills] == ["premiers-pas", "tableaux"]
    first, second = skills
    assert first.name_en == "First steps"
    assert first.mastery == 1  # défaut pour 1 problème
    assert second.requires == ["premiers-pas"]
    assert second.mastery == 1  # surchargé (défaut : 2 pour 2 problèmes)
    assert (second.x, second.y) == (120.0, -60.0)


def test_load_skills_absent_returns_empty(tmp_path):
    assert load_skills(tmp_path, SLUGS) == []


def test_default_mastery_is_two_thirds():
    assert [default_mastery(n) for n in (1, 2, 3, 4, 5)] == [1, 2, 2, 3, 4]


@pytest.mark.parametrize(
    ("yaml_text", "fragment"),
    [
        ("- pas un mapping\n", "clé `skills`"),
        (
            "skills:\n  - id: a\n    name: A\n    position: [0, 0]\n    problems: [inconnu]\n",
            "inconnu",
        ),
        (
            "skills:\n  - id: a\n    name: A\n    position: [0, 0]\n"
            "    problems: [deux-sommes]\n    requires: [fantome]\n",
            "fantome",
        ),
        (
            "skills:\n"
            "  - {id: a, name: A, position: [0, 0], problems: [deux-sommes], requires: [b]}\n"
            "  - {id: b, name: B, position: [1, 0], problems: [deux-sommes], requires: [a]}\n",
            "cycle",
        ),
        (
            "skills:\n  - {id: a, name: A, position: [0, 0], "
            "problems: [deux-sommes], requires: [a]}\n",
            "requérir",
        ),
        (
            "skills:\n"
            "  - {id: a, name: A, position: [0, 0], problems: [deux-sommes]}\n"
            "  - {id: a, name: Bis, position: [1, 0], problems: [deux-sommes]}\n",
            "double",
        ),
        (
            "skills:\n  - {id: a, name: A, problems: [deux-sommes]}\n",
            "position",
        ),
        (
            "skills:\n  - {id: a, name: A, position: [0, 0], "
            "problems: [deux-sommes], mastery: 3}\n",
            "mastery",
        ),
        (
            "skills:\n  - {id: a, name: A, position: [0, 0], problems: []}\n",
            "problems",
        ),
    ],
)
def test_load_rejects_broken_skills(tmp_path, yaml_text, fragment):
    write_skills(tmp_path, yaml_text)
    with pytest.raises(ContentError) as exc:
        load_skills(tmp_path, SLUGS)
    assert fragment in str(exc.value)


def _seed_problems(db) -> None:
    for i, slug in enumerate(sorted(SLUGS)):
        db.add(
            Problem(
                slug=slug,
                title=slug.replace("-", " ").title(),
                category="bases",
                difficulty=i + 1,
                statement_fr="Énoncé.",
                tests=[
                    ProblemTest(position=1, input="x\n", expected_output="y\n", is_sample=True),
                    ProblemTest(position=2, input="x\n", expected_output="y\n"),
                ],
            )
        )
    db.commit()


def test_sync_skills_replaces_previous_tree(tmp_path, db):
    _seed_problems(db)
    loaded = load_skills(write_skills(tmp_path), SLUGS)
    sync_skills(db, loaded)
    sync_skills(db, loaded)  # resynchronisation idempotente

    skills = db.query(Skill).all()
    assert len(skills) == 2
    tableaux = next(s for s in skills if s.slug == "tableaux")
    assert [sp.problem.slug for sp in tableaux.problems] == [
        "tri-de-dossards",
        "la-meilleure-semaine",
    ]
    assert [p.prerequisite.slug for p in tableaux.prerequisites] == ["premiers-pas"]

    sync_skills(db, loaded[:1])  # un arbre réduit remplace l'ancien
    assert [s.slug for s in db.query(Skill).all()] == ["premiers-pas"]


def test_sync_skills_requires_imported_problems(db):
    from app.content.loader import LoadedSkill

    orphan = LoadedSkill(
        id="a", name_fr="A", name_en=None, description_fr=None, description_en=None,
        x=0, y=0, problems=["jamais-importe"], mastery=1,
    )
    with pytest.raises(ContentError, match="jamais-importe"):
        sync_skills(db, [orphan])


def test_tree_states_follow_progression(tmp_path, db, client):
    """Chaîne premiers-pas → tableaux → algorithmes : un AC sur deux-sommes
    maîtrise le 1er nœud, recommande le 2e, laisse le 3e « pas encore prêt »."""
    _seed_problems(db)
    chain = VALID_SKILLS_YAML + (
        "  - id: algorithmes\n"
        "    name: Algorithmes\n"
        "    requires: [tableaux]\n"
        "    position: [240, -120]\n"
        "    problems: [la-meilleure-semaine]\n"
    )
    sync_skills(db, load_skills(write_skills(tmp_path, chain), SLUGS))

    user = register(client)
    deux_sommes = db.query(Problem).filter_by(slug="deux-sommes").one()
    db.add(
        Submission(
            user_id=user["id"], problem_id=deux_sommes.id, language="python",
            source_code="print()", status="done", verdict="AC",
        )
    )
    db.commit()

    resp = client.get("/api/skills/tree")
    assert resp.status_code == 200, resp.text
    nodes = {n["slug"]: n for n in resp.json()}
    assert nodes["premiers-pas"]["state"] == "mastered"
    assert nodes["premiers-pas"]["solved_count"] == 1
    assert nodes["tableaux"]["state"] == "recommended"
    assert nodes["tableaux"]["requires"] == ["premiers-pas"]
    assert nodes["algorithmes"]["state"] == "not_ready"
    problems = {p["slug"]: p for p in nodes["premiers-pas"]["problems"]}
    assert problems["deux-sommes"]["solved"] is True


def test_tree_requires_auth(client):
    assert client.get("/api/skills/tree").status_code == 401


def test_repo_skills_yaml_is_valid():
    """L'arbre réel du dépôt doit toujours passer la validation de format."""
    slugs = {p.name for p in discover_problems(CONTENT_DIR)}
    skills = load_skills(CONTENT_DIR, slugs)
    assert len(skills) >= 3
