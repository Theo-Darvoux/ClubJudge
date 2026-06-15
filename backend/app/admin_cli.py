"""CLI d'administration des comptes : `clubjudge-admin promote|demote|list`.

Le premier admin ne peut pas s'auto-promouvoir par l'API — on passe par ici,
sur la machine qui a accès à la base.
"""

import argparse
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Role, User


def _set_role(email: str, role: Role) -> int:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email.lower()))
        if user is None:
            print(f"ERREUR aucun compte avec l'email {email}", file=sys.stderr)
            return 1
        user.role = role
        db.commit()
        print(f"OK {user.display_name} <{user.email}> est maintenant {role}")
        return 0


def _list_admins() -> int:
    with SessionLocal() as db:
        admins = db.scalars(select(User).where(User.role == Role.ADMIN).order_by(User.email)).all()
    if not admins:
        print("Aucun admin — utilisez `clubjudge-admin promote <email>`.")
    for user in admins:
        print(f"{user.display_name} <{user.email}>")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="clubjudge-admin", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    promote = sub.add_parser("promote", help="donner le rôle admin à un compte")
    promote.add_argument("email")
    demote = sub.add_parser("demote", help="repasser un compte en membre")
    demote.add_argument("email")
    sub.add_parser("list", help="lister les admins")

    args = parser.parse_args()
    if args.command == "promote":
        raise SystemExit(_set_role(args.email, Role.ADMIN))
    if args.command == "demote":
        raise SystemExit(_set_role(args.email, Role.MEMBER))
    raise SystemExit(_list_admins())


if __name__ == "__main__":
    main()
