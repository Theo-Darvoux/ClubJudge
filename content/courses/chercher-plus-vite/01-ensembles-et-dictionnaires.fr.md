---
practice:
  - la-paire-parfaite
---

# Ensembles et dictionnaires

Le cours « Bien démarrer » vous a appris à compter les opérations. Voici le
premier outil qui en fait *disparaître* : la table de hachage, déguisée en
`set` et en `dict`. Sa promesse : répondre à « est-ce que je l'ai déjà ? » en
temps **constant**, quel que soit le nombre d'éléments stockés.

## Le piège du `in` sur une liste

En Python, `x in ma_liste` est une boucle cachée : elle compare $x$ à chaque
élément, en $O(n)$. Dans une boucle qui tourne déjà $n$ fois, c'est du
$O(n^2)$ qui ne dit pas son nom :

```python
vus = []
for x in valeurs:
    if x in vus:        # O(n) à chaque tour → O(n²) au total
        ...
    vus.append(x)
```

Remplacez la liste par un **ensemble** et la même ligne devient $O(1)$ en
moyenne :

```python
vus = set()
for x in valeurs:
    if x in vus:        # O(1) en moyenne
        ...
    vus.add(x)
```

C'est la modification d'une ligne — et c'est souvent toute la différence
entre TLE et Accepté.

## Comment ça marche (en deux phrases)

Une table de hachage calcule à partir de la valeur un numéro de case
(le *hash*), et range la valeur dans cette case. Tester l'appartenance, c'est
recalculer le numéro et regarder une seule case — d'où le temps constant en
moyenne, indépendant de la taille.

## Le dictionnaire : un ensemble qui retient quelque chose

Quand « déjà vu ? » ne suffit pas et qu'il faut *combien de fois* (ou *où*,
ou *quoi*), l'ensemble devient **dictionnaire** : clé → valeur, mêmes coûts.

```python
from collections import Counter

compte = Counter()
for x in valeurs:
    compte[x] += 1      # Counter : un dict qui répond 0 aux absents
```

```cpp
#include <unordered_map>
#include <unordered_set>

std::unordered_set<long long> vus;
std::unordered_map<long long, long long> compte;
if (vus.count(x)) { /* déjà vu */ }
compte[x]++;
```

En C++, attention au piège inverse : `std::set` et `std::map` existent aussi,
mais ce sont des arbres équilibrés en $O(\log n)$ — très bien, simplement pas
gratuits. Les versions hachées s'appellent `unordered_set` / `unordered_map`.

## Ce que le hachage rend facile

| Question | Outil | Coût total |
|---|---|---|
| y a-t-il un doublon ? | `set` | $O(n)$ |
| combien de valeurs distinctes ? | `len(set(v))` | $O(n)$ |
| combien de fois chaque valeur ? | `Counter` / `unordered_map` | $O(n)$ |
| deux éléments somment-ils à $t$ ? | dict des « déjà vus » | $O(n)$ |

La dernière ligne est le schéma le plus important : pour chaque élément $v$,
le partenaire qu'il lui faut est *calculable* ($t - v$), et le dictionnaire
dit en $O(1)$ s'il est déjà passé. Vous l'utiliserez dans le problème
d'entraînement.

## À vous

Le TP est l'application la plus directe : trouver le premier doublon dans un
flot de $2 \times 10^5$ numéros. La force brute est trop lente — c'est voulu.

```tp
le-doublon
```

## Pour aller plus loin

Le « temps constant » est une moyenne : des cas pathologiques existent (tout
finir dans la même case), et l'ordre de parcours d'un `set`/`unordered_set`
n'est jamais garanti. Si l'ordre compte, triez — c'est justement le sujet de
l'article suivant, où le tri débloque une autre recherche rapide : la
dichotomie.
