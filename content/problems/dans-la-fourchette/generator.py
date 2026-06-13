"""Génère le gros test 03 (n = q = 10^5) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/03.in && python solutions/solution.py < tests/03.in > tests/03.out
"""

import random

random.seed(20260613)
n = q = 100_000
# Beaucoup de doublons (valeurs dans [0, 10^6]) pour punir les confusions
# lower/upper sur les bornes ; quelques fourchettes très larges.
prices = [random.randint(0, 10**6) for _ in range(n)]
print(n, q)
print(" ".join(map(str, prices)))
for _ in range(q):
    if random.random() < 0.1:
        a, b = 0, 10**9
    else:
        a = random.randint(0, 10**6)
        b = random.randint(a, min(a + random.choice([0, 10, 10**4]), 10**9))
    print(a, b)
