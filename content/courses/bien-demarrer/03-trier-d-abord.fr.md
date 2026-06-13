---
practice:
  - binomes-de-niveau
---

# Trier d'abord, réfléchir ensuite

Le tri est l'outil le plus rentable de votre boîte : une ligne de code,
$O(n \log n)$, et beaucoup de questions difficiles sur un tableau en désordre
deviennent faciles sur un tableau trié.

## La bibliothèque standard trie pour vous

N'écrivez jamais votre propre tri en concours — celui de la bibliothèque
standard est correct, rapide, et déjà débogué :

```python
valeurs.sort()                      # tri en place
classement = sorted(joueurs, key=lambda j: j[1], reverse=True)
```

```cpp
std::sort(v.begin(), v.end());
std::sort(v.begin(), v.end(), [](auto& a, auto& b) {
    return a.score > b.score;       // décroissant sur un champ
});
```

Ce qui se décide vraiment, c'est **la clé de tri** : trier des paires
(score, nom), trier par valeur absolue, trier des intervalles par borne de
droite… La ligne de tri encode souvent la moitié de l'idée.

## Ce qu'un tableau trié rend facile

- **Le min, le max, les ex æquo** : aux extrémités, ou côte à côte.
- **Les doublons** : deux valeurs égales sont voisines après tri.
- **Les paires proches** : la paire de valeurs les plus proches est
  forcément deux voisins du tableau trié — comparer $n-1$ voisins au lieu
  de $\binom{n}{2}$ paires.
- **Chercher** : la dichotomie répond en $O(\log n)$ — mais elle exige
  un tableau trié.

Le réflexe à acquérir : devant un problème sur un tableau, demandez-vous
*« et si je le triais ? »* avant toute autre idée. Ça ne marche pas toujours
(quand l'ordre d'origine compte, par exemple), mais ça marche étonnamment
souvent.

## À vous

Le TP demande un tri simple ; le problème d'entraînement en dessous demande
le réflexe « paires proches » décrit ci-dessus.

```tp
tri-de-dossards
```
