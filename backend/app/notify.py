"""Annonces Discord du club (PLAN.md Phase 2) via un webhook.

Tout est best-effort : si `discord_webhook_url` n'est pas configuré ou si
Discord est injoignable, on logue et la plateforme continue — une annonce
ratée ne doit jamais casser un contest.

Deux canaux d'émission :
- les événements ponctuels (création de contest, first blood) sont envoyés au
  fil de l'eau par le code qui les détecte ;
- `ContestAnnouncer` est une tâche de fond qui annonce les débuts de contest
  et publie les résultats à la fin de la fenêtre.
"""

import asyncio
import contextlib
import logging
from datetime import datetime

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal, as_utc
from app.models import Contest

logger = logging.getLogger(__name__)

LAVENDER = 0xDCB7FF
MEDALS = ["🥇", "🥈", "🥉"]


def _ts(dt: datetime, style: str = "f") -> str:
    """Timestamp dynamique Discord : affiché dans le fuseau de chaque lecteur."""
    return f"<t:{int(as_utc(dt).timestamp())}:{style}>"


async def _post(title: str, description: str) -> None:
    url = get_settings().discord_webhook_url
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                json={"embeds": [{"title": title, "description": description, "color": LAVENDER}]},
            )
            resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("discord webhook failed for %r", title, exc_info=True)


async def contest_created(title: str, start_at: datetime, end_at: datetime) -> None:
    await _post(
        f"📣 Nouveau contest : {title}",
        f"Début {_ts(start_at)} ({_ts(start_at, 'R')}), fin {_ts(end_at, 't')}."
        "\nInscriptions ouvertes sur ClubJudge !",
    )


async def contest_started(title: str, end_at: datetime, problem_count: int) -> None:
    await _post(
        f"🟢 C'est parti : {title}",
        f"{problem_count} problème(s), fin {_ts(end_at)} ({_ts(end_at, 'R')}). Bonne chance !",
    )


async def first_blood(contest_title: str, label: str, problem_title: str, member: str) -> None:
    await _post(
        f"🎈 First blood — {contest_title}",
        f"**{member}** ouvre le problème **{label} · {problem_title}** !",
    )


async def contest_results(title: str, podium: list[tuple[int, str, int, int]]) -> None:
    """podium : (rang, nom, résolus, pénalité), déjà limité au top."""
    if podium:
        lines = [
            f"{MEDALS[i] if i < len(MEDALS) else f'{rank}.'} **{name}** — "
            f"{solved} résolu(s), pénalité {penalty} min"
            for i, (rank, name, solved, penalty) in enumerate(podium)
        ]
        body = "\n".join(lines) + "\n\nClassement complet et upsolving sur ClubJudge."
    else:
        body = "Personne au départ cette fois-ci… au prochain !"
    await _post(f"🏁 Résultats : {title}", body)


class ContestAnnouncer:
    """Vérifie périodiquement les fenêtres : annonce les contests qui viennent
    de commencer, publie les résultats de ceux qui viennent de finir. Les
    drapeaux `*_announced` en base évitent les doublons entre redémarrages."""

    def __init__(self, session_factory=SessionLocal, interval_s: float = 30.0):
        self._session_factory = session_factory
        self._interval_s = interval_s
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _run(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("contest announcer tick failed")
            await asyncio.sleep(self._interval_s)

    async def tick(self) -> None:
        # Import local : contests.py importe notify pour les événements ponctuels.
        from app.contests import build_scoreboard, utcnow

        now = utcnow()
        with self._session_factory() as db:
            started = db.scalars(
                select(Contest).where(Contest.start_announced.is_(False), Contest.start_at <= now)
            ).all()
            for contest in started:
                contest.start_announced = True
                db.commit()
                if as_utc(contest.end_at) > now:  # un contest déjà fini ne s'annonce plus
                    await contest_started(contest.title, contest.end_at, len(contest.problems))

            finished = db.scalars(
                select(Contest).where(Contest.results_announced.is_(False), Contest.end_at <= now)
            ).all()
            for contest in finished:
                contest.results_announced = True
                db.commit()
                board = build_scoreboard(db, contest, now, me=None)
                podium = [
                    (row.rank, row.display_name, row.solved, row.penalty_min)
                    for row in board.rows[:3]
                    if row.solved > 0
                ]
                await contest_results(contest.title, podium)
