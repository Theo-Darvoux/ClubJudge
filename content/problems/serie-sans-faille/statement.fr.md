Votre historique de présence aux séances du club tient en une ligne de $0$ et
de $1$ : présent ou absent. Les séances sont filmées, et vous avez le temps de
rattraper au plus $k$ absences en replay. En comptant ces rattrapages, quelle
est la plus longue série de séances **consécutives** que vous pouvez avoir
suivies ?

## Entrée

- La première ligne contient deux entiers $n$ et $k$
  ($1 \le n \le 2 \times 10^5$, $0 \le k \le n$), le nombre de séances et le
  nombre maximal de rattrapages.
- La deuxième ligne contient $n$ entiers $s_1, \dots, s_n$ valant $0$
  (absent) ou $1$ (présent).

## Sortie

La longueur maximale d'une suite de séances consécutives contenant au plus
$k$ zéros.

## Exemples

### Entrée

```
10 2
1 1 0 1 0 1 1 0 1 1
```

### Sortie

```
7
```

En rattrapant les séances $3$ et $5$, vous avez suivi les séances $1$ à $7$ :
une série de $7$. (Rattraper les séances $5$ et $8$ donne aussi $7$, avec les
séances $4$ à $10$.)

### Entrée

```
6 0
1 0 1 1 1 0
```

### Sortie

```
3
```
