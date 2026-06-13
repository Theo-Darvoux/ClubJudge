"""Génère le gros test 04 (2*10^5 séances) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/04.in && python solutions/solution.py < tests/04.in > tests/04.out
"""

import random

random.seed(20260613)
n = 200_000
k = 1_000
# 85 % de présences : des fenêtres longues, le quota se vide souvent.
sessions = [1 if random.random() < 0.85 else 0 for _ in range(n)]
print(n, k)
print(" ".join(map(str, sessions)))
