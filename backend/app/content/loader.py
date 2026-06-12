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
    tests: list[TestCase] = field(default_factory=list)
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
    tests: list[TestCase] = []
    for in_path in sorted(tests_dir.glob("*.in")):
        out_path = in_path.with_suffix(".out")
        _require(out_path.is_file(), out_path, f"sortie attendue manquante pour {in_path.name}")
        tests.append(TestCase(input=in_path.read_text(), expected_output=out_path.read_text()))
    _require(len(tests) >= 2, tests_dir, "au moins 2 tests requis (un exemple ne suffit pas)")
    orphans = [p.name for p in sorted(tests_dir.glob("*.out"))
               if not p.with_suffix(".in").is_file()]
    _require(not orphans, tests_dir, f"fichiers .out sans .in correspondant : {orphans}")

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
        tests=tests,
        solutions=solutions,
    )


def discover_problems(content_dir: Path) -> list[Path]:
    problems_dir = content_dir / "problems"
    if not problems_dir.is_dir():
        return []
    return sorted(p for p in problems_dir.iterdir() if p.is_dir())
