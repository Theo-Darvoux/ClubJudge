"""Cours et TP interactifs (Phase 3) : format, synchronisation, API."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.content.importer import sync_courses, sync_skills
from app.content.loader import (
    ContentError,
    article_refs,
    discover_courses,
    discover_problems,
    extract_tp_slugs,
    load_course,
    load_skills,
)
from app.models import (
    ArticleRead,
    Contest,
    ContestProblem,
    ContestRegistration,
    Course,
    Problem,
    ProblemTest,
    Submission,
)
from tests.conftest import register

CONTENT_DIR = Path(__file__).parent.parent.parent / "content"

SLUGS = {"deux-sommes", "tri-de-dossards", "la-meilleure-semaine"}

ARTICLE_1 = """\
# Entrées et sorties

Lire, calculer, écrire.

```tp
deux-sommes
```
"""

ARTICLE_2 = """\
---
practice:
  - la-meilleure-semaine
---

# Trier

Le tri rend tout facile.

```tp
tri-de-dossards
```
"""


def write_course(root: Path, files: dict[str, str] | None = None) -> Path:
    course_dir = root / "courses" / "bases"
    course_dir.mkdir(parents=True)
    defaults = {
        "course.yaml": "title: Les bases\ncategory: Fondamentaux\n",
        "01-entrees-sorties.fr.md": ARTICLE_1,
        "02-trier.fr.md": ARTICLE_2,
    }
    for name, text in (files if files is not None else defaults).items():
        (course_dir / name).write_text(text)
    return course_dir


def test_load_valid_course(tmp_path):
    course = load_course(write_course(tmp_path), SLUGS)
    assert course.slug == "bases"
    assert course.title == "Les bases"
    assert [a.slug for a in course.articles] == ["entrees-sorties", "trier"]
    first, second = course.articles
    assert first.position == 1
    assert first.title_fr == "Entrées et sorties"
    assert first.title_fr not in first.body_fr  # le titre est extrait du corps
    assert first.tp_problems == ["deux-sommes"]
    assert first.practice == []
    assert second.practice == ["la-meilleure-semaine"]
    assert second.tp_problems == ["tri-de-dossards"]


def test_extract_tp_slugs_ignores_other_fences():
    body = "```python\nprint()\n```\n\n```tp\ndeux-sommes\n```\n"
    assert extract_tp_slugs(body) == ["deux-sommes"]


def test_load_course_reads_english_translation(tmp_path):
    course_dir = write_course(tmp_path)
    (course_dir / "01-entrees-sorties.en.md").write_text("# Input and output\n\nRead, write.\n")
    course = load_course(course_dir, SLUGS)
    assert course.articles[0].title_en == "Input and output"
    assert "Read, write." in (course.articles[0].body_en or "")
    assert course.articles[1].title_en is None


@pytest.mark.parametrize(
    ("files", "fragment"),
    [
        ({"01-a.fr.md": ARTICLE_1}, "course.yaml manquant"),
        ({"course.yaml": "category: X\n", "01-a.fr.md": ARTICLE_1}, "title"),
        ({"course.yaml": "title: T\ncategory: X\n"}, "au moins un article"),
        (
            {"course.yaml": "title: T\ncategory: X\n", "intro.fr.md": ARTICLE_1},
            "NN-slug.fr.md",
        ),
        (
            {"course.yaml": "title: T\ncategory: X\n", "01-a.fr.md": "Pas de titre.\n"},
            "titre de niveau 1",
        ),
        (
            {
                "course.yaml": "title: T\ncategory: X\n",
                "01-a.fr.md": "# A\n\n```tp\nprobleme-fantome\n```\n",
            },
            "probleme-fantome",
        ),
        (
            {
                "course.yaml": "title: T\ncategory: X\n",
                "01-a.fr.md": "---\npractice: [deux-sommes]\n---\n\n# A\n\n"
                "```tp\ndeux-sommes\n```\n",
            },
            "à la fois",
        ),
        (
            {
                "course.yaml": "title: T\ncategory: X\n",
                "01-a.fr.md": "---\nauteur: moi\n---\n\n# A\n\nCorps.\n",
            },
            "clé de frontmatter inconnue",
        ),
        (
            {
                "course.yaml": "title: T\ncategory: X\n",
                "01-a.fr.md": ARTICLE_1,
                "01-b.fr.md": ARTICLE_1,
            },
            "déjà utilisé",
        ),
        (
            {
                "course.yaml": "title: T\ncategory: X\n",
                "01-a.fr.md": ARTICLE_1,
                "02-b.en.md": "# B\n\nBody.\n",
            },
            "sans .fr.md",
        ),
    ],
)
def test_load_rejects_broken_courses(tmp_path, files, fragment):
    write_course(tmp_path, files)
    with pytest.raises(ContentError) as exc:
        load_course(tmp_path / "courses" / "bases", SLUGS)
    assert fragment in str(exc.value)


def _seed_problems(db) -> dict[str, Problem]:
    problems = {}
    for i, slug in enumerate(sorted(SLUGS)):
        problem = Problem(
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
        db.add(problem)
        problems[slug] = problem
    db.commit()
    return problems


def test_sync_courses_upserts_and_preserves_reads(tmp_path, db, client):
    _seed_problems(db)
    loaded = [load_course(write_course(tmp_path), SLUGS)]
    sync_courses(db, loaded)
    course = db.query(Course).one()
    assert [a.slug for a in course.articles] == ["entrees-sorties", "trier"]
    assert [ap.problem.slug for ap in course.articles[1].problems] == [
        "tri-de-dossards",
        "la-meilleure-semaine",
    ]

    # Marque de lecture posée, puis contenu mis à jour : la marque survit.
    user = register(client)
    db.add(ArticleRead(user_id=user["id"], article_id=course.articles[0].id))
    db.commit()
    read_article_id = course.articles[0].id

    sync_courses(db, loaded)  # resynchronisation idempotente
    course = db.query(Course).one()
    assert course.articles[0].id == read_article_id  # upsert, pas de recréation
    assert db.query(ArticleRead).count() == 1

    # Un article retiré du dépôt disparaît (avec ses marques de lecture).
    loaded[0].articles = loaded[0].articles[1:]
    sync_courses(db, loaded)
    course = db.query(Course).one()
    assert [a.slug for a in course.articles] == ["trier"]
    assert db.query(ArticleRead).count() == 0

    # Un cours retiré du dépôt disparaît.
    sync_courses(db, [])
    assert db.query(Course).count() == 0


def test_sync_courses_requires_imported_problems(db, tmp_path):
    with pytest.raises(ContentError, match="deux-sommes"):
        sync_courses(db, [load_course(write_course(tmp_path), SLUGS)])


def test_skills_link_to_articles(tmp_path, db, client):
    _seed_problems(db)
    sync_courses(db, [load_course(write_course(tmp_path), SLUGS)])

    yaml_text = (
        "skills:\n"
        "  - id: premiers-pas\n"
        "    name: Premiers pas\n"
        "    position: [0, 0]\n"
        "    problems: [deux-sommes]\n"
        "    articles: [bases/entrees-sorties]\n"
    )
    (tmp_path / "skills.yaml").write_text(yaml_text)
    skills = load_skills(tmp_path, SLUGS, {"bases/entrees-sorties"})
    sync_skills(db, skills)

    register(client)
    resp = client.get("/api/skills/tree")
    assert resp.status_code == 200, resp.text
    (node,) = resp.json()
    assert node["articles"] == [
        {
            "course_slug": "bases",
            "article_slug": "entrees-sorties",
            "title_fr": "Entrées et sorties",
            "title_en": None,
        }
    ]


def test_load_skills_rejects_unknown_article(tmp_path):
    (tmp_path / "skills.yaml").write_text(
        "skills:\n"
        "  - id: a\n"
        "    name: A\n"
        "    position: [0, 0]\n"
        "    problems: [deux-sommes]\n"
        "    articles: [fantome/article]\n"
    )
    with pytest.raises(ContentError, match="fantome/article"):
        load_skills(tmp_path, SLUGS, {"bases/entrees-sorties"})


def _import_course(tmp_path, db):
    _seed_problems(db)
    sync_courses(db, [load_course(write_course(tmp_path), SLUGS)])


def test_courses_require_auth(client):
    assert client.get("/api/courses").status_code == 401


def test_list_courses_with_progress(tmp_path, db, client):
    _import_course(tmp_path, db)
    user = register(client)

    (course,) = client.get("/api/courses").json()
    assert course["slug"] == "bases"
    assert course["article_count"] == 2
    assert course["read_count"] == 0
    assert course["tp_total"] == 2
    assert course["tp_solved"] == 0

    # Un AC sur le TP du 1er article fait progresser le compteur.
    deux_sommes = db.query(Problem).filter_by(slug="deux-sommes").one()
    db.add(
        Submission(
            user_id=user["id"], problem_id=deux_sommes.id, language="python",
            source_code="print()", status="done", verdict="AC",
        )
    )
    db.commit()
    (course,) = client.get("/api/courses").json()
    assert course["tp_solved"] == 1


def test_course_detail_lists_articles(tmp_path, db, client):
    _import_course(tmp_path, db)
    register(client)

    course = client.get("/api/courses/bases").json()
    assert [a["slug"] for a in course["articles"]] == ["entrees-sorties", "trier"]
    assert course["articles"][0]["tp_total"] == 1
    assert client.get("/api/courses/inconnu").status_code == 404


def test_article_detail_and_navigation(tmp_path, db, client):
    _import_course(tmp_path, db)
    register(client)

    article = client.get("/api/courses/bases/articles/entrees-sorties").json()
    assert article["title_fr"] == "Entrées et sorties"
    assert "```tp\ndeux-sommes\n```" in article["body_fr"]
    assert article["read"] is False
    assert article["prev"] is None
    assert article["next"]["slug"] == "trier"

    second = client.get("/api/courses/bases/articles/trier").json()
    assert second["prev"]["slug"] == "entrees-sorties"
    assert second["next"] is None
    assert [p["slug"] for p in second["practice"]] == ["la-meilleure-semaine"]

    assert client.get("/api/courses/bases/articles/inconnu").status_code == 404


def test_mark_read_is_idempotent(tmp_path, db, client):
    _import_course(tmp_path, db)
    register(client)

    for _ in range(2):
        resp = client.post("/api/courses/bases/articles/entrees-sorties/read")
        assert resp.status_code == 204
    assert db.query(ArticleRead).count() == 1

    article = client.get("/api/courses/bases/articles/entrees-sorties").json()
    assert article["read"] is True
    course = client.get("/api/courses/bases").json()
    assert course["read_count"] == 1


def test_problem_page_links_back_to_articles(tmp_path, db, client):
    _import_course(tmp_path, db)
    register(client)

    problem = client.get("/api/problems/deux-sommes").json()
    assert problem["articles"] == [
        {
            "course_slug": "bases",
            "article_slug": "entrees-sorties",
            "title_fr": "Entrées et sorties",
            "title_en": None,
        }
    ]


def test_contest_problem_hidden_from_practice_and_links(tmp_path, db, client):
    """Un problème rattaché à un contest non terminé reste secret : ni dans
    « pour pratiquer », ni en lien d'article sur sa page (conditions ICPC)."""
    _import_course(tmp_path, db)
    user = register(client)

    now = datetime.now(UTC)
    semaine = db.query(Problem).filter_by(slug="la-meilleure-semaine").one()
    contest = Contest(
        slug="c1", title="C1",
        start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1),
        problems=[ContestProblem(problem_id=semaine.id, label="A")],
        registrations=[ContestRegistration(user_id=user["id"])],
    )
    db.add(contest)
    db.commit()

    article = client.get("/api/courses/bases/articles/trier").json()
    assert article["practice"] == []

    # Inscrit au contest en cours : la page du problème est accessible mais ne
    # pointe pas vers l'article qui couvre la notion (ce serait un indice).
    problem = client.get("/api/problems/la-meilleure-semaine").json()
    assert problem["contest"]["slug"] == "c1"
    assert problem["articles"] == []


def test_repo_courses_are_valid():
    """Les cours réels du dépôt doivent toujours passer la validation."""
    slugs = {p.name for p in discover_problems(CONTENT_DIR)}
    courses = [load_course(c, slugs) for c in discover_courses(CONTENT_DIR)]
    assert len(courses) >= 1
    assert "bien-demarrer/entrees-et-sorties" in article_refs(courses)
