"""Génère le gros test 03 (10^5 niveaux) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/03.in && python solutions/solution.py < tests/03.in > tests/03.out
"""

import random

random.seed(20260612)
n = 100_000
# Valeurs distinctes : avec des doublons la réponse serait 0, et un programme
# qui répond toujours 0 passerait — le test 02 couvre déjà ce cas.
values = random.sample(range(10**9 + 1), n)
print(n)
print(" ".join(map(str, values)))
