"""Génère le gros test 03 (10^5 jours).

Usage : python generator.py > tests/03.in && python solutions/solution.py < tests/03.in > tests/03.out
"""

import random

random.seed(20260612)
n = 100_000
print(n)
print(" ".join(str(random.randint(-10_000, 10_000)) for _ in range(n)))
