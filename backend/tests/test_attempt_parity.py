"""Garde-fou : la définition d'un « essai » et la borne de l'historique doivent
rester identiques côté serveur et côté client.

- Les verdicts qui ne comptent pas comme une tentative (`NON_ATTEMPT_VERDICTS`)
  décident du badge « résolu en N essais » et de la pénalité du classement ; le
  client en fait une estimation immédiate avec la MÊME liste.
- La borne de l'historique (`MAX_HISTORY_ROWS`) décide quand cette estimation est
  partielle (donc à confirmer via /solve-stats) ; le client plafonne son historique
  à la même valeur.

Les deux ne peuvent pas partager une constante (frontière Python/TypeScript) ; ce
test échoue donc si l'un dérive de l'autre.
"""

import re
from pathlib import Path

from app.judge.types import NON_ATTEMPT_VERDICTS
from app.submissions import MAX_HISTORY_ROWS

_ATTEMPTS_TS = Path(__file__).resolve().parents[2] / "frontend/src/problems/attempts.ts"


def test_client_non_attempt_verdicts_match_server() -> None:
    text = _ATTEMPTS_TS.read_text(encoding="utf-8")
    m = re.search(r"NON_ATTEMPT_VERDICTS:\s*readonly Verdict\[\]\s*=\s*\[([^\]]*)\]", text)
    assert m, "NON_ATTEMPT_VERDICTS introuvable dans attempts.ts"
    client = set(re.findall(r"'([^']+)'", m.group(1)))
    server = {v.value for v in NON_ATTEMPT_VERDICTS}
    assert client == server, f"client {client} != serveur {server}"


def test_client_history_limit_matches_server() -> None:
    text = _ATTEMPTS_TS.read_text(encoding="utf-8")
    m = re.search(r"MAX_HISTORY_ROWS\s*=\s*(\d+)", text)
    assert m, "MAX_HISTORY_ROWS introuvable dans attempts.ts"
    assert int(m.group(1)) == MAX_HISTORY_ROWS
