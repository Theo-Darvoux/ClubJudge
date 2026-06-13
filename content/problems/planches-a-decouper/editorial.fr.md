La dichotomie ne sert pas qu'à chercher dans un tableau trié. Ici, il n'y a
aucun tableau à trier — et pourtant la dichotomie résout le problème. C'est le
schéma « **dichotomie sur la réponse** », l'un des plus puissants du concours.

## Renverser le problème

Calculer directement le meilleur $L$ est difficile. Mais **vérifier** un $L$
donné est trivial : une planche de longueur $\ell$ donne
$\lfloor \ell / L \rfloor$ tasseaux, donc

$$\text{ça passe}(L) \iff \sum_i \lfloor \ell_i / L \rfloor \ge k$$

se teste en $O(n)$.

## La monotonie, clé de voûte

Si des tasseaux de longueur $L$ sont possibles, des tasseaux plus courts le
sont aussi : $\text{ça passe}$ est **vraie sur $\{1, \dots, L^\*\}$ puis
fausse partout au-delà**. Une propriété monotone à frontière inconnue, c'est
exactement ce qu'une dichotomie localise — en testant $\sim \log_2(10^9)
\approx 30$ valeurs :

```python
import sys

data = sys.stdin.buffer.read().split()
k = int(data[1])
lengths = list(map(int, data[2:]))


def enough(size: int) -> bool:
    return sum(length // size for length in lengths) >= k


lo, hi = 0, max(lengths)
while lo < hi:
    mid = (lo + hi + 1) // 2
    if enough(mid):
        lo = mid
    else:
        hi = mid - 1
print(lo)
```

L'invariant : `lo` passe toujours (avec la convention que $0$ passe — c'est la
réponse du cas impossible), `hi + 1` échoue toujours. Le `+ 1` dans le milieu
évite la boucle infinie quand `hi = lo + 1` : on cherche le **dernier vrai**,
le milieu doit arrondir vers le haut.

Coût total : $O(n \log \max \ell)$.

## Les pièges

- **La boucle infinie** : `mid = (lo + hi) // 2` avec `lo = mid` ne progresse
  plus quand `hi = lo + 1`. Cherchez « dernier vrai » → arrondir le milieu
  vers le haut ; « premier faux » → vers le bas.
- **Le débordement** : $\sum \ell_i$ atteint $10^{14}$ — `long long` en C++.
  En C++, couper la somme dès que $k$ est atteint évite même d'y penser.
- **Le cas impossible** : $k$ tasseaux introuvables même à $L = 1$ ; partir de
  `lo = 0` le gère sans cas particulier.

À retenir : quand « calculer le meilleur X » est dur mais « X = telle valeur,
ça passe ? » est facile *et monotone*, faites une dichotomie sur X. Vous
venez d'échanger un problème d'optimisation contre 30 problèmes de décision.
