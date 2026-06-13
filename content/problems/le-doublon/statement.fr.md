À la rentrée, la machine du secrétariat distribue un numéro d'adhérent à
chaque nouveau membre. Elle est censée ne jamais donner deux fois le même…
mais elle vieillit. Trouvez le premier numéro distribué en double.

## Entrée

- La première ligne contient un entier $n$ ($1 \le n \le 2 \times 10^5$),
  le nombre de numéros distribués.
- La deuxième ligne contient $n$ entiers $a_1, \dots, a_n$
  ($0 \le a_i \le 10^9$), les numéros dans l'ordre de distribution.

## Sortie

La valeur du premier numéro distribué alors qu'il l'avait déjà été — c'est-à-dire
$a_j$ pour le plus petit $j$ tel que $a_j$ apparaisse déjà parmi
$a_1, \dots, a_{j-1}$. Si tous les numéros sont distincts, affichez $-1$.

## Exemples

### Entrée

```
7
3 1 4 1 5 9 3
```

### Sortie

```
1
```

Au quatrième tirage, le numéro $1$ ressort alors qu'il avait déjà été
distribué. Le $3$ ressort aussi plus tard, mais le $1$ est le premier doublon.

### Entrée

```
4
10 20 30 40
```

### Sortie

```
-1
```
