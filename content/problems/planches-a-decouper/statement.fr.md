Le club construit des étagères pour le local et a récupéré $n$ planches de
longueurs diverses. Il faut $k$ tasseaux de **même longueur entière** $L$.
Chaque planche peut être découpée en plusieurs tasseaux (les chutes sont
perdues), mais un tasseau ne peut pas enjamber deux planches. Quelle est la
plus grande longueur $L$ possible ?

## Entrée

- La première ligne contient deux entiers $n$ et $k$
  ($1 \le n \le 10^5$, $1 \le k \le 10^9$), le nombre de planches et le
  nombre de tasseaux requis.
- La deuxième ligne contient $n$ entiers $\ell_1, \dots, \ell_n$
  ($1 \le \ell_i \le 10^9$), les longueurs des planches.

## Sortie

La plus grande longueur entière $L \ge 1$ telle qu'on puisse découper au
moins $k$ tasseaux de longueur $L$, c'est-à-dire telle que
$\sum_i \lfloor \ell_i / L \rfloor \ge k$. S'il est impossible d'obtenir $k$
tasseaux même avec $L = 1$, affichez $0$.

## Exemples

### Entrée

```
4 7
5 7 9 4
```

### Sortie

```
3
```

Avec $L = 3$ : $\lfloor 5/3 \rfloor + \lfloor 7/3 \rfloor + \lfloor 9/3
\rfloor + \lfloor 4/3 \rfloor = 1 + 2 + 3 + 1 = 7$ tasseaux — juste assez.
Avec $L = 4$ on n'en obtient que $1 + 1 + 2 + 1 = 5$.

### Entrée

```
2 100
3 4
```

### Sortie

```
0
```

Même en tasseaux de $1$, ces deux planches n'en donnent que $7$.
