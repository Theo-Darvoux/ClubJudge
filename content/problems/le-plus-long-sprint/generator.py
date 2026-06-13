"""Génère le gros test 04 (2*10^5 jours) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/04.in && python solutions/solution.py < tests/04.in > tests/04.out
"""

import random

random.seed(20260613)
n = 200_000
efforts = [random.randint(0, 10**9) for _ in range(n)]
# Une plage de jours « gratuits » au milieu pour que la réponse soit non triviale,
# et un budget qui force la fenêtre à se resserrer souvent.
for i in range(120_000, 120_400):
    efforts[i] = random.randint(0, 100)
budget = 5 * 10**9
print(n, budget)
print(" ".join(map(str, efforts)))
