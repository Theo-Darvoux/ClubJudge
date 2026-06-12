"""CLI auteur : `clubjudge-content validate|import [chemin]`.

`validate` vérifie le format et fait passer les solutions de référence par le
juge (Judge0 du docker-compose) — à lancer localement et en CI sur chaque PR.
`import` fait la même chose puis synchronise la base.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from app.config import get_settings
from app.content.importer import import_problem_dir, validate_solutions
from app.content.loader import ContentError, discover_problems, load_problem
from app.db import SessionLocal
from app.judge import Judge0Judge


async def _run(command: str, content_dir: Path) -> int:
    problem_dirs = discover_problems(content_dir)
    if not problem_dirs:
        print(f"Aucun problème trouvé dans {content_dir / 'problems'}", file=sys.stderr)
        return 1

    judge = Judge0Judge(get_settings().judge0_url)
    failures = 0
    for problem_dir in problem_dirs:
        try:
            if command == "validate":
                loaded = load_problem(problem_dir)
                await validate_solutions(loaded, judge)
            else:
                with SessionLocal() as db:
                    await import_problem_dir(db, judge, problem_dir)
            print(f"  OK  {problem_dir.name}")
        except ContentError as exc:
            failures += 1
            print(f"ÉCHEC {problem_dir.name}\n      {exc}", file=sys.stderr)

    total = len(problem_dirs)
    print(f"\n{total - failures}/{total} problème(s) valide(s)")
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="clubjudge-content")
    parser.add_argument("command", choices=["validate", "import"])
    parser.add_argument(
        "content_dir", nargs="?", default=get_settings().content_dir,
        help="dossier content/ (défaut : %(default)s)",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(args.command, Path(args.content_dir).resolve())))


if __name__ == "__main__":
    main()
