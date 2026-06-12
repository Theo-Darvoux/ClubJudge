"""Lecture et validation de format d'un dossier content/problems/<slug>/.

Format défini dans PLAN.md §3. Toute erreur lève ContentError avec un message
actionnable pour l'auteur du problème (affiché par la CLI et la CI).
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.judge.types import Language, TestCase

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

SOLUTION_EXTENSIONS: dict[str, Language] = {
    ".c": Language.C,
    ".cpp": Language.CPP,
    ".py": Language.PYTHON,
    ".java": Language.JAVA,
}


class ContentError(Exception):
    def __init__(self, path: Path, message: str):
        self.path = path
        super().__init__(f"{path}: {message}")


@dataclass
class ReferenceSolution:
    path: Path
    language: Language
    source_code: str


@dataclass
class LoadedProblem:
    slug: str
    title: str
    category: str
    difficulty: int
    tags: list[str]
    time_limit_s: float
    memory_limit_kb: int
    statement_fr: str
    statement_en: str | None
    editorial_fr: str | None = None
    editorial_en: str | None = None
    hints: list[str] = field(default_factory=list)
    # Les exemples (sample*.in) sont placés en tête de la liste.
    tests: list[TestCase] = field(default_factory=list)
    sample_count: int = 0
    solutions: list[ReferenceSolution] = field(default_factory=list)


def _require(condition: bool, path: Path, message: str) -> None:
    if not condition:
        raise ContentError(path, message)


def load_problem(problem_dir: Path) -> LoadedProblem:
    slug = problem_dir.name
    _require(SLUG_RE.match(slug) is not None, problem_dir,
             "le nom du dossier doit être un slug (minuscules, chiffres, tirets)")

    meta_path = problem_dir / "problem.yaml"
    _require(meta_path.is_file(), meta_path, "fichier problem.yaml manquant")
    meta = yaml.safe_load(meta_path.read_text())
    _require(isinstance(meta, dict), meta_path, "problem.yaml doit être un mapping YAML")

    for key in ("title", "category", "difficulty"):
        _require(key in meta, meta_path, f"champ obligatoire manquant : {key}")
    difficulty = meta["difficulty"]
    _require(isinstance(difficulty, int) and 1 <= difficulty <= 5, meta_path,
             "difficulty doit être un entier entre 1 et 5")
    tags = meta.get("tags", [])
    _require(isinstance(tags, list) and all(isinstance(t, str) for t in tags), meta_path,
             "tags doit être une liste de chaînes")

    statement_path = problem_dir / "statement.fr.md"
    _require(statement_path.is_file(), statement_path, "énoncé statement.fr.md manquant")
    statement_en_path = problem_dir / "statement.en.md"

    tests_dir = problem_dir / "tests"
    _require(tests_dir.is_dir(), tests_dir, "dossier tests/ manquant")
    # Convention : sample*.in = exemples de l'énoncé (publics, exécutables sans
    # soumettre), le reste = tests secrets. Les exemples passent en premier.
    sample_paths = sorted(tests_dir.glob("sample*.in"))
    secret_paths = [p for p in sorted(tests_dir.glob("*.in")) if p not in sample_paths]
    tests: list[TestCase] = []
    for in_path in sample_paths + secret_paths:
        out_path = in_path.with_suffix(".out")
        _require(out_path.is_file(), out_path, f"sortie attendue manquante pour {in_path.name}")
        tests.append(TestCase(input=in_path.read_text(), expected_output=out_path.read_text()))
    _require(len(sample_paths) >= 1, tests_dir,
             "au moins un test exemple requis (sample1.in/sample1.out, "
             "reprenant l'exemple de l'énoncé)")
    _require(len(tests) >= 2, tests_dir, "au moins 2 tests requis (un exemple ne suffit pas)")
    orphans = [p.name for p in sorted(tests_dir.glob("*.out"))
               if not p.with_suffix(".in").is_file()]
    _require(not orphans, tests_dir, f"fichiers .out sans .in correspondant : {orphans}")

    hints_path = problem_dir / "hints.yaml"
    hints: list[str] = []
    if hints_path.is_file():
        raw_hints = yaml.safe_load(hints_path.read_text())
        _require(
            isinstance(raw_hints, list)
            and len(raw_hints) >= 1
            and all(isinstance(h, str) and h.strip() for h in raw_hints),
            hints_path,
            "hints.yaml doit être une liste YAML de chaînes non vides "
            "(un indice par élément, du plus vague au plus précis)",
        )
        hints = [h.strip() for h in raw_hints]

    editorial_fr_path = problem_dir / "editorial.fr.md"
    editorial_en_path = problem_dir / "editorial.en.md"
    _require(
        not editorial_en_path.is_file() or editorial_fr_path.is_file(),
        editorial_en_path,
        "editorial.en.md présent sans editorial.fr.md (le français est la langue de référence)",
    )

    solutions_dir = problem_dir / "solutions"
    _require(solutions_dir.is_dir(), solutions_dir, "dossier solutions/ manquant")
    solutions = [
        ReferenceSolution(path=p, language=SOLUTION_EXTENSIONS[p.suffix],
                          source_code=p.read_text())
        for p in sorted(solutions_dir.iterdir())
        if p.suffix in SOLUTION_EXTENSIONS
    ]
    _require(len(solutions) >= 1, solutions_dir,
             "au moins une solution de référence requise (.c, .cpp, .py ou .java)")

    return LoadedProblem(
        slug=slug,
        title=str(meta["title"]),
        category=str(meta["category"]),
        difficulty=difficulty,
        tags=[t.strip().lower() for t in tags],
        time_limit_s=float(meta.get("time_limit_s", 2.0)),
        memory_limit_kb=int(meta.get("memory_limit_kb", 262_144)),
        statement_fr=statement_path.read_text(),
        statement_en=statement_en_path.read_text() if statement_en_path.is_file() else None,
        editorial_fr=editorial_fr_path.read_text() if editorial_fr_path.is_file() else None,
        editorial_en=editorial_en_path.read_text() if editorial_en_path.is_file() else None,
        hints=hints,
        tests=tests,
        sample_count=len(sample_paths),
        solutions=solutions,
    )


def discover_problems(content_dir: Path) -> list[Path]:
    problems_dir = content_dir / "problems"
    if not problems_dir.is_dir():
        return []
    return sorted(p for p in problems_dir.iterdir() if p.is_dir())
