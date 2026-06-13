"""Génère le gros test 04 (10^5 planches) — lancé par l'auteur, committé en .in/.out.

Usage : python generator.py > tests/04.in && python solutions/solution.py < tests/04.in > tests/04.out

Somme des longueurs ~ 5 * 10^13 : le décompte de tasseaux déborde un int 32 bits.
"""

import random

random.seed(20260613)
n = 100_000
lengths = [random.randint(1, 10**9) for _ in range(n)]
# k choisi pour que la réponse soit une longueur « moyenne », ni 1 ni max.
k = sum(lengths) // 1_000_000
print(n, k)
print(" ".join(map(str, lengths)))
