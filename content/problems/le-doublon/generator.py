"""Génère le gros test 04 (2*10^5 numéros) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/04.in && python solutions/solution.py < tests/04.in > tests/04.out
"""

import random

random.seed(20260613)
n = 200_000
# Le seul doublon est tout à la fin : une force brute O(n^2) qui s'arrête au
# premier doublon doit quand même parcourir toutes les paires avant de le voir.
values = random.sample(range(10**9 + 1), n - 1)
values.append(values[0])
print(n)
print(" ".join(map(str, values)))
