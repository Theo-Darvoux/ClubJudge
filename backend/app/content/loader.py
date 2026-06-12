"""Lecture et validation de format du dépôt de contenu.

Problèmes (content/problems/<slug>/) et arbre de compétences (content/skills.yaml).
Format défini dans PLAN.md §3 et §Phase 1.5. Toute erreur lève ContentError avec
un message actionnable pour l'auteur (affiché par la CLI et la CI).
"""

import math
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


@dataclass
class LoadedSkill:
    id: str
    name_fr: str
    name_en: str | None
    description_fr: str | None
    description_en: str | None
    x: float
    y: float
    requires: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    mastery: int = 1


def default_mastery(problem_count: int) -> int:
    """Seuil de maîtrise par défaut : ~2/3 des problèmes du nœud (3 → 2, 5 → 4).
    Surchargeable par nœud avec la clé `mastery`."""
    return max(1, math.ceil(problem_count * 2 / 3))


def _check_acyclic(skills: dict[str, LoadedSkill], path: Path) -> None:
    # Parcours en profondeur trois couleurs : un nœud gris revisité = cycle.
    WHITE, GREY, BLACK = 0, 1, 2
    color = dict.fromkeys(skills, WHITE)

    def visit(skill_id: str, trail: list[str]) -> None:
        color[skill_id] = GREY
        for req in skills[skill_id].requires:
            if color[req] == GREY:
                cycle = " → ".join([*trail, skill_id, req])
                raise ContentError(path, f"cycle dans les prérequis : {cycle}")
            if color[req] == WHITE:
                visit(req, [*trail, skill_id])
        color[skill_id] = BLACK

    for skill_id in skills:
        if color[skill_id] == WHITE:
            visit(skill_id, [])


def load_skills(content_dir: Path, problem_slugs: set[str]) -> list[LoadedSkill]:
    """Charge et valide content/skills.yaml. `problem_slugs` est l'ensemble des
    problèmes connus du contexte d'appel (dossiers du dépôt pour la CLI, base
    pour l'import). Retourne [] si le fichier n'existe pas (arbre optionnel)."""
    path = content_dir / "skills.yaml"
    if not path.is_file():
        return []

    raw = yaml.safe_load(path.read_text())
    _require(isinstance(raw, dict) and isinstance(raw.get("skills"), list), path,
             "skills.yaml doit être un mapping YAML avec une clé `skills` (liste de nœuds)")

    skills: dict[str, LoadedSkill] = {}
    for i, node in enumerate(raw["skills"]):
        where = f"nœud #{i + 1}"
        _require(isinstance(node, dict), path, f"{where} : chaque nœud doit être un mapping")
        skill_id = node.get("id")
        _require(isinstance(skill_id, str) and SLUG_RE.match(skill_id) is not None, path,
                 f"{where} : `id` doit être un slug (minuscules, chiffres, tirets)")
        where = f"nœud `{skill_id}`"
        _require(skill_id not in skills, path, f"{where} : id en double")

        name = node.get("name")
        _require(isinstance(name, str) and name.strip() != "", path,
                 f"{where} : `name` (nom affiché, en français) est obligatoire")

        position = node.get("position")
        _require(
            isinstance(position, list) and len(position) == 2
            and all(isinstance(c, int | float) for c in position),
            path, f"{where} : `position` doit être une paire [x, y] (fixée à la main)",
        )

        problems = node.get("problems")
        _require(
            isinstance(problems, list) and len(problems) >= 1
            and all(isinstance(p, str) for p in problems),
            path, f"{where} : `problems` doit lister au moins un slug de problème",
        )
        _require(len(set(problems)) == len(problems), path,
                 f"{where} : slugs de problèmes en double")
        unknown = [p for p in problems if p not in problem_slugs]
        _require(not unknown, path, f"{where} : problème(s) inconnu(s) : {unknown}")

        requires = node.get("requires", [])
        _require(isinstance(requires, list) and all(isinstance(r, str) for r in requires),
                 path, f"{where} : `requires` doit être une liste d'ids de compétences")
        _require(skill_id not in requires, path, f"{where} : un nœud ne peut pas se requérir")

        mastery = node.get("mastery", default_mastery(len(problems)))
        _require(isinstance(mastery, int) and 1 <= mastery <= len(problems), path,
                 f"{where} : `mastery` doit être un entier entre 1 et {len(problems)} "
                 "(nb de problèmes résolus pour maîtriser le nœud)")

        for key in ("name_en", "description", "description_en"):
            value = node.get(key)
            _require(value is None or (isinstance(value, str) and value.strip() != ""),
                     path, f"{where} : `{key}` doit être une chaîne non vide si présent")

        skills[skill_id] = LoadedSkill(
            id=skill_id,
            name_fr=name.strip(),
            name_en=node.get("name_en"),
            description_fr=node.get("description"),
            description_en=node.get("description_en"),
            x=float(position[0]),
            y=float(position[1]),
            requires=requires,
            problems=problems,
            mastery=mastery,
        )

    for skill in skills.values():
        unknown = [r for r in skill.requires if r not in skills]
        _require(not unknown, path,
                 f"nœud `{skill.id}` : prérequis inconnu(s) : {unknown}")
    _check_acyclic(skills, path)
    return list(skills.values())
