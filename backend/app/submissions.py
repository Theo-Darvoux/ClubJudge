import time
from datetime import UTC, datetime, timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, defer, joinedload, load_only, selectinload

from app.auth import get_current_user
from app.config import get_settings
from app.contests import invalidate_scoreboard, require_contest_access
from app.db import as_utc, get_db
from app.judge.base import Judge
from app.judge.types import Language, Verdict
from app.judging import JudgeWorker
from app.models import Contest, Problem, Submission, User
from app.problems import get_problem_or_404

router = APIRouter(prefix="/api", tags=["submissions"])

MAX_SOURCE_BYTES = 64 * 1024
MAX_CUSTOM_INPUT_BYTES = 64 * 1024
MAX_RUN_OUTPUT_CHARS = 4096

# Nombre maximum de soumissions renvoyées dans l'historique d'un problème. Le
# client borne le sien de la même façon (cf. MAX_HISTORY_ROWS dans
# frontend/src/problems/attempts.ts, tenu en phase par backend/tests/
# test_attempt_parity.py) : au-delà, son estimation « résolu en N essais » est
# marquée comme partielle et confirmée par /solve-stats.
MAX_HISTORY_ROWS = 50

# Cooldown (en secondes) renvoyé AVEC une réponse de succès, pour que le client
# arme son compte à rebours sans deviner la valeur serveur. On n'utilise PAS
# `Retry-After` : ce dernier est réservé aux réponses qui demandent d'attendre
# (429/503), pas à un 2xx. Exposé via CORS (cf. main.py) pour être lisible même
# en cross-origin. Le 429 de rate-limiting porte, lui, un vrai `Retry-After`.
COOLDOWN_HEADER = "X-Cooldown-Seconds"
# Court exprès : l'essai est jetable et tester plusieurs exemples à la suite doit
# rester fluide. Il ne sert qu'à amortir le spam vers le juge (vs. les 10 s de
# soumission, plus lourde et persistée).
RUN_COOLDOWN_S = 1.0

# Anti-spam léger pour les exécutions d'essai (non persistées, donc en mémoire ;
# suffisant tant que l'API tourne en un seul process).
_last_run_at: dict[int, float] = {}
# Au-delà de ce nombre d'entrées, on purge celles déjà hors cooldown : le dict
# reste borné même après le passage de nombreux utilisateurs.
_RUN_TIMES_PRUNE_AT = 1024
_last_prune_at: float = 0.0


def _prune_run_times(now: float) -> None:
    global _last_prune_at
    if now - _last_prune_at < 60.0 and len(_last_run_at) < _RUN_TIMES_PRUNE_AT:
        return
    _last_prune_at = now
    stale = [uid for uid, t in _last_run_at.items() if now - t > RUN_COOLDOWN_S]
    for uid in stale:
        del _last_run_at[uid]


def get_worker(request: Request) -> JudgeWorker:
    return request.app.state.judge_worker


def get_judge(request: Request) -> Judge:
    return request.app.state.judge


def _contest_access(db: Session, user: User, problem: Problem) -> Contest | None:
    """404 si le problème appartient à un contest non terminé et que
    l'utilisateur n'y a pas accès ; sinon, le contest en cours qui donne accès
    (None pour un problème public)."""
    res = require_contest_access(db, user, problem.id, datetime.now(UTC))
    return res.contest if res else None


class SubmissionPayload(BaseModel):
    language: Language
    source_code: str = Field(min_length=1)


class SubmissionOut(BaseModel):
    id: int
    problem_slug: str
    language: str
    status: str
    verdict: str | None
    time_s: float | None
    memory_kb: int | None
    compile_output: str | None
    failed_test: int | None
    created_at: datetime

    @classmethod
    def from_model(cls, s: Submission) -> "SubmissionOut":
        return cls(
            id=s.id,
            problem_slug=s.problem.slug,
            language=s.language,
            status=s.status,
            verdict=s.verdict,
            time_s=s.time_s,
            memory_kb=s.memory_kb,
            compile_output=s.compile_output,
            failed_test=s.failed_test,
            created_at=s.created_at,
        )


class SubmissionDetailOut(SubmissionOut):
    """Vue détaillée d'une soumission : porte aussi le code source, pour le
    rappeler dans l'éditeur depuis l'historique (« réutiliser ce code »)."""

    source_code: str

    @classmethod
    def from_model(cls, s: Submission) -> "SubmissionDetailOut":
        base = SubmissionOut.from_model(s)
        return cls(**base.model_dump(), source_code=s.source_code)


@router.post("/problems/{slug}/submissions", status_code=status.HTTP_201_CREATED)
def submit(
    slug: str,
    payload: SubmissionPayload,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    worker: Annotated[JudgeWorker, Depends(get_worker)],
) -> SubmissionOut:
    if len(payload.source_code.encode()) > MAX_SOURCE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "source_too_large")

    # Seuls l'id (accès contest) et le slug (réponse) sont nécessaires ici.
    problem = get_problem_or_404(db, slug, options=[load_only(Problem.slug)])

    # Problème de contest : accessible pendant la fenêtre aux seuls inscrits,
    # et la soumission est alors rattachée au contest (scoreboard).
    contest = _contest_access(db, user, problem)

    # Rate limiting par utilisateur : protège la file et la machine (PLAN.md 1a).
    # Verrouille l'utilisateur pour sérialiser les vérifications de cooldown.
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    cooldown = timedelta(seconds=get_settings().submission_cooldown_s)
    last = db.scalar(
        select(Submission.created_at)
        .where(Submission.user_id == user.id)
        .order_by(Submission.created_at.desc())
        .limit(1)
    )
    if last is not None:
        elapsed = datetime.now(UTC) - as_utc(last)
        if elapsed < cooldown:
            retry_after = int((cooldown - elapsed).total_seconds()) + 1
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                {"code": "cooldown", "retry_after_s": retry_after},
                headers={"Retry-After": str(retry_after)},
            )

    submission = Submission(
        user_id=user.id,
        # On affecte la relation (déjà chargée, slug compris) plutôt que le seul
        # `problem_id` : `SubmissionOut.from_model` lit `s.problem.slug` pour la
        # réponse, et sans la relation peuplée cet accès déclencherait une requête
        # de plus (la session ne l'expire pas, cf. expire_on_commit=False).
        problem=problem,
        contest_id=contest.id if contest else None,
        language=payload.language,
        source_code=payload.source_code,
    )
    db.add(submission)
    db.commit()  # persistée avant tout envoi au juge
    if contest is not None:
        # La cellule du classement passe « en attente » dès la soumission.
        invalidate_scoreboard(contest.id)
    worker.enqueue(submission.id)
    # Le cooldown effectif accompagne la réponse : le client n'a pas à deviner la
    # valeur configurée côté serveur pour afficher son compte à rebours.
    response.headers[COOLDOWN_HEADER] = str(get_settings().submission_cooldown_s)
    return SubmissionOut.from_model(submission)


class RunPayload(BaseModel):
    language: Language
    source_code: str = Field(min_length=1)
    # Sans options : tous les exemples. `custom_input` : une entrée libre (pas de
    # comparaison). `sample_index` : un seul exemple, comparé par le juge.
    custom_input: str | None = None
    sample_index: int | None = Field(default=None, ge=0)


class RunCaseOut(BaseModel):
    verdict: str
    input: str
    expected_output: str | None
    stdout: str | None
    stderr: str | None
    time_s: float | None
    # Au moins un des champs texte (entrée, attendu, stdout, stderr) a été coupé
    # pour borner le transport : le client le signale et prévient que le diff peut
    # être incomplet. La mémoire n'est volontairement pas exposée pour un essai —
    # l'affichage des essais se limite au verdict, au temps et aux E/S (cf. le
    # Workbench) ; on ne transporte pas un champ que rien n'affiche.
    truncated: bool = False


class RunOut(BaseModel):
    compile_output: str | None
    cases: list[RunCaseOut]


# NOTE: Gardé synchrone par backend/tests/test_diff_parity.py. Ne pas modifier sans adapter le test.
_TRAILING_WS = " \t\r\f\v"


def _normalized_lines(text: str) -> list[str]:
    """Tolérance d'égalité des essais, alignée sur le diff client : espaces de fin
    de ligne (``_TRAILING_WS``) et lignes vides finales ignorés."""
    return [line.rstrip(_TRAILING_WS) for line in text.rstrip("\n").split("\n")]


def _truncate(text: str | None) -> tuple[str | None, bool]:
    """Coupe un texte trop long. Renvoie (texte, tronqué) plutôt que d'insérer un
    marqueur dans le texte : ce dernier fausserait le diff côté client. Appliqué à
    TOUS les champs texte d'un cas (entrée, attendu, stdout, stderr) pour qu'aucun
    ne soit transporté sans borne."""
    if text is None or len(text) <= MAX_RUN_OUTPUT_CHARS:
        return text, False
    return text[:MAX_RUN_OUTPUT_CHARS], True


@router.post("/problems/{slug}/run")
async def run_code(
    slug: str,
    payload: RunPayload,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    judge: Annotated[Judge, Depends(get_judge)],
) -> RunOut:
    """Exécution d'essai : exemples de l'énoncé ou entrée personnalisée.

    Jamais enregistrée comme soumission — c'est le filet de sécurité qui lève
    la peur de soumettre (PLAN.md 1b).
    """
    if len(payload.source_code.encode()) > MAX_SOURCE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "source_too_large")
    if (
        payload.custom_input is not None
        and len(payload.custom_input.encode()) > MAX_CUSTOM_INPUT_BYTES
    ):
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "input_too_large")
    if payload.custom_input is not None and payload.sample_index is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "ambiguous_run")

    # Anti-spam AVANT le chargement du problème et de ses tests : une requête
    # rejetée ne doit pas payer le coût DB. On réserve le créneau tout de suite
    # (sinon deux requêtes concurrentes le franchiraient toutes les deux), quitte
    # à le rembourser plus bas si le juge est injoignable.
    now = time.monotonic()
    _prune_run_times(now)
    last = _last_run_at.get(user.id)
    if last is not None and now - last < RUN_COOLDOWN_S:
        retry_after = int(RUN_COOLDOWN_S - (now - last)) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            {"code": "cooldown", "retry_after_s": retry_after},
            headers={"Retry-After": str(retry_after)},
        )
    _last_run_at[user.id] = now
    # Cooldown effectif renvoyé au client pour son compte à rebours (cf. submit).
    response.headers[COOLDOWN_HEADER] = str(int(RUN_COOLDOWN_S))

    problem = get_problem_or_404(
        db,
        slug,
        options=[
            selectinload(Problem.tests),
            load_only(Problem.time_limit_s, Problem.memory_limit_kb),
        ],
    )
    _contest_access(db, user, problem)

    if payload.custom_input is not None:
        inputs = [payload.custom_input]
        expected: list[str | None] = [None]
    else:
        samples = [t for t in problem.tests if t.is_sample]
        if not samples:
            raise HTTPException(status.HTTP_409_CONFLICT, "no_samples")
        if payload.sample_index is not None:
            if payload.sample_index >= len(samples):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "sample_not_found")
            samples = [samples[payload.sample_index]]
        inputs = [t.input for t in samples]
        expected = [t.expected_output for t in samples]

    try:
        result = await judge.run(
            payload.source_code,
            payload.language,
            inputs,
            time_limit_s=problem.time_limit_s,
            memory_limit_kb=problem.memory_limit_kb,
        )
    except (httpx.HTTPError, TimeoutError) as exc:
        # L'essai n'a jamais atteint le juge : on rembourse le créneau réservé
        # (on restaure l'horodatage précédent) pour ne pas pénaliser le membre
        # d'une panne côté serveur. Seulement si notre réservation tient toujours :
        # si une requête concurrente du même membre a réservé depuis, restaurer un
        # horodatage plus ancien rouvrirait son cooldown par erreur.
        if _last_run_at.get(user.id) == now:
            if last is None:
                _last_run_at.pop(user.id, None)
            else:
                _last_run_at[user.id] = last
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "judge_unavailable") from exc

    cases: list[RunCaseOut] = []
    for run, stdin, expected_output in zip(result.runs, inputs, expected, strict=True):
        verdict = run.verdict
        # Le juge n'a pas comparé (pas de sortie attendue envoyée) : on compare
        # ici, avec la même tolérance, sur le texte COMPLET (avant troncature) pour
        # que le verdict AC/WA reste exact même quand l'affichage sera coupé.
        if verdict is Verdict.ACCEPTED and expected_output is not None:
            got = _normalized_lines(run.stdout or "")
            if got != _normalized_lines(expected_output):
                verdict = Verdict.WRONG_ANSWER
        # Tous les champs texte sont bornés pour le transport ; un seul drapeau
        # suffit à prévenir que l'affichage (et donc le diff) peut être incomplet.
        stdin_out, t_in = _truncate(stdin)
        expected_out, t_exp = _truncate(expected_output)
        stdout, t_out = _truncate(run.stdout)
        stderr, t_err = _truncate(run.stderr)
        cases.append(
            RunCaseOut(
                verdict=verdict,
                input=stdin_out or "",
                expected_output=expected_out,
                stdout=stdout,
                stderr=stderr,
                time_s=run.time_s,
                truncated=t_in or t_exp or t_out or t_err,
            )
        )
    return RunOut(compile_output=result.compile_output, cases=cases)


@router.get("/submissions/{submission_id}")
def get_submission(
    submission_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SubmissionDetailOut:
    submission = db.scalar(
        select(Submission)
        .options(joinedload(Submission.problem).load_only(Problem.slug))
        .where(Submission.id == submission_id)
    )
    if submission is None or submission.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission_not_found")
    return SubmissionDetailOut.from_model(submission)


@router.get("/problems/{slug}/submissions")
def list_my_submissions(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SubmissionOut]:
    problem = get_problem_or_404(db, slug, options=[load_only(Problem.id)])
    _contest_access(db, user, problem)
    # `source_code` (potentiellement volumineux) n'est pas affiché dans
    # l'historique : on le diffère. En revanche on NE diffère PAS `compile_output`
    # — `SubmissionOut.from_model` le lit, et un attribut différé déclencherait
    # une requête par ligne (N+1). Il est borné et le plus souvent NULL, donc
    # chargé dans la requête principale il ne coûte rien.
    submissions = db.scalars(
        select(Submission)
        .options(
            joinedload(Submission.problem).load_only(Problem.slug),
            defer(Submission.source_code),
        )
        .where(Submission.user_id == user.id, Submission.problem_id == problem.id)
        .order_by(Submission.created_at.desc())
        .limit(MAX_HISTORY_ROWS)
    ).all()
    return [SubmissionOut.from_model(s) for s in submissions]
