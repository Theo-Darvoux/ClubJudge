"""Génère le gros test 04 (2*10^5 niveaux) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/04.in && python solutions/solution.py < tests/04.in > tests/04.out

La réponse dépasse 2^32 : 180 000 copies de la même valeur donnent
C(180000, 2) ≈ 1.6 * 10^10 paires — un compteur 32 bits déborde.
"""

import random

random.seed(20260613)
n = 200_000
t = 14
values = [7] * 180_000 + [random.randint(15, 10**9) for _ in range(20_000)]
random.shuffle(values)
print(n, t)
print(" ".join(map(str, values)))
