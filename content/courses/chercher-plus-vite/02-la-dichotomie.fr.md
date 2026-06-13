---
practice:
  - planches-a-decouper
---

# La dichotomie

Chercher un mot dans le dictionnaire (le vrai, en papier), personne ne le
fait page par page : on ouvre au milieu, on compare, on jette une moitié.
C'est la **dichotomie** — $\log_2(10^9) \approx 30$ étapes pour un milliard
de possibilités. Sa seule exigence : que les données soient *ordonnées*.

## Sur un tableau trié

Dans un tableau trié, « où se trouverait $x$ ? » se répond en $O(\log n)$.
N'écrivez pas la boucle vous-même au début — les bornes `lo`/`hi` sont le
nid à bugs le plus célèbre de l'informatique. La bibliothèque standard la
fournit, juste, déjà déboguée :

```python
import bisect

i = bisect.bisect_left(v, x)   # nb de valeurs < x ; position d'insertion
j = bisect.bisect_right(v, x)  # nb de valeurs <= x
# x est présent  ⟺  i < j ;  il apparaît  j - i  fois
```

```cpp
auto lo = std::lower_bound(v.begin(), v.end(), x);  // 1ʳᵉ position >= x
auto hi = std::upper_bound(v.begin(), v.end(), x);  // 1ʳᵉ position >  x
```

La paire left/right (ou lower/upper) n'est pas un détail : avec des doublons,
c'est elle qui décide si la borne est incluse. « Combien de valeurs dans
$[a, b]$ ? » s'écrit exactement
`bisect_right(v, b) - bisect_left(v, a)` — les deux fonctions, une de chaque.

Le coût d'entrée est le tri, $O(n \log n)$, payé **une fois**. C'est l'achat
le plus rentable quand les questions sont nombreuses : trier une fois,
répondre $q$ fois en $O(\log n)$.

## La dichotomie sur la réponse

Le tour de force, c'est quand il n'y a *aucun tableau*. Beaucoup de problèmes
d'optimisation ont cette forme :

> calculer le meilleur $X$ est difficile, mais « est-ce que $X = v$
> passerait ? » est facile à vérifier — et si $v$ passe, tout ce qui est
> en dessous passe aussi.

Cette **monotonie** suffit : la frontière vrai/faux se localise par
dichotomie sur les valeurs de $X$, en testant $\approx 30$ candidats.

```python
lo, hi = 0, maximum_possible      # invariant : lo passe, hi + 1 échoue
while lo < hi:
    mid = (lo + hi + 1) // 2      # arrondi vers le HAUT : on cherche le dernier vrai
    if ca_passe(mid):
        lo = mid
    else:
        hi = mid - 1
# lo est le meilleur X
```

Le `+ 1` du milieu est vital : sans lui, `lo = mid` ne progresse plus quand
`hi = lo + 1` et la boucle tourne pour toujours. Règle mnémotechnique :
*dernier vrai* → milieu vers le haut ; *premier faux* → milieu vers le bas.

## À vous

Le TP applique « trier puis compter » : des dizaines de milliers de questions
« combien de prix entre $a$ et $b$ ? ». Le problème d'entraînement est une
vraie dichotomie sur la réponse — le schéma ci-dessus s'y transcrit
presque mot pour mot.

```tp
dans-la-fourchette
```
