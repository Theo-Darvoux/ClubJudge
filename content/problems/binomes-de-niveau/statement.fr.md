Pour le tournoi par équipes, on veut former un binôme le plus équilibré
possible : deux membres dont les niveaux sont les plus proches. Donnez l'écart
de niveau de ce meilleur binôme.

## Entrée

- La première ligne contient un entier $n$ ($2 \le n \le 10^5$), le nombre de membres.
- La deuxième ligne contient $n$ entiers $v_1, \dots, v_n$
  ($0 \le v_i \le 10^9$), leurs niveaux, séparés par des espaces.

## Sortie

Le plus petit écart $|v_i - v_j|$ possible entre deux membres distincts
($i \ne j$).

## Exemple

### Entrée

```
5
8 1 17 4 12
```

### Sortie

```
3
```

Le meilleur binôme est $\{1, 4\}$ (écart $3$). Aucune paire ne fait mieux :
$\{8, 12\}$ et $\{8, 4\}$ font $4$, toutes les autres davantage.

Notez que deux membres peuvent avoir le même niveau — l'écart est alors $0$.
