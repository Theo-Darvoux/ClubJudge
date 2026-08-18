"""Garde-fou : la tolérance d'espaces de fin doit rester identique côté juge
(`_TRAILING_WS`) et côté client (`TRAILING_WS_CLASS` dans diff.ts).

Les deux ne peuvent pas partager une constante (frontière Python/TypeScript) ;
ce test échoue donc si l'un dérive de l'autre, ce qui désaccorderait le verdict
des essais et l'affichage du diff.
"""

import re
from pathlib import Path

from app.submissions import _TRAILING_WS, _normalized_lines

_DIFF_TS = Path(__file__).resolve().parents[2] / "frontend/src/components/diff.ts"

# Échappements de classe de caractères regex qu'on s'attend à rencontrer.
_REGEX_ESCAPES = {"t": "\t", "r": "\r", "f": "\f", "v": "\v", "n": "\n"}


def _decode_char_class(body: str) -> set[str]:
    """Ensemble des caractères d'un corps de classe regex (ex. ` \\t\\r`)."""
    chars: set[str] = set()
    i = 0
    while i < len(body):
        c = body[i]
        if c == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            chars.add(_REGEX_ESCAPES.get(nxt, nxt))
            i += 2
        else:
            chars.add(c)
            i += 1
    return chars


def test_client_trailing_ws_class_matches_server():
    text = _DIFF_TS.read_text(encoding="utf-8")
    m = re.search(r"TRAILING_WS_CLASS\s*=\s*'([^']*)'", text)
    assert m, "TRAILING_WS_CLASS introuvable dans diff.ts"

    # 1) Déséchappement de la chaîne JS (\\ → \), 2) on retire les crochets,
    # 3) on décode les échappements de classe regex (\t → tabulation).
    js_unescaped = m.group(1).replace("\\\\", "\\")
    assert js_unescaped.startswith("[") and js_unescaped.endswith("]"), js_unescaped
    client_chars = _decode_char_class(js_unescaped[1:-1])

    assert client_chars == set(_TRAILING_WS)


def test_client_strips_trailing_newlines_like_server():
    """Seconde moitié de la tolérance : avant de comparer ligne à ligne, les deux
    bords retirent les sauts de ligne finaux. Côté serveur c'est ``rstrip("\\n")``
    (cf. _normalized_lines) ; côté client c'est ``.replace(/\\n+$/, '')`` appliqué à
    `expected` ET `got`. Ce test échoue si le client cesse de le faire — sinon une
    sortie correcte suivie d'un saut de ligne final passerait WA d'un seul côté."""
    text = _DIFF_TS.read_text(encoding="utf-8")
    strips = re.findall(r"\.replace\(/\\n\+\$/,\s*''\)", text)
    # Une fois pour `expected`, une fois pour `got` : les deux entrées normalisées.
    assert len(strips) >= 2, "diff.ts ne retire plus les sauts de ligne finaux comme le serveur"


# La normalisation serveur (_normalized_lines) est le contrat que le diff client
# doit refléter : on l'épingle ici pour qu'une dérive future soit visible.
def test_normalized_lines_drops_trailing_newlines_and_blank_lines():
    assert _normalized_lines("a\nb\n\n\n") == ["a", "b"]


def test_normalized_lines_strips_per_line_trailing_whitespace():
    assert _normalized_lines("a  \nb\t\n") == ["a", "b"]


def test_normalized_lines_tolerates_carriage_returns():
    # Sorties à fins de ligne Windows : le \r final de chaque ligne est toléré.
    assert _normalized_lines("a\r\nb\r\n") == ["a", "b"]


def test_normalized_lines_preserves_interior_blank_lines():
    # Seules les lignes vides FINALES sont ignorées ; une vide au milieu compte.
    assert _normalized_lines("a\n\nb\n") == ["a", "", "b"]
