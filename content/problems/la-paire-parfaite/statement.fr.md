Pour le tournoi en binômes, l'organisateur vise des équipes d'un niveau
combiné exactement égal à $t$. Combien de binômes possibles atteignent
précisément cette cible ?

## Entrée

- La première ligne contient deux entiers $n$ et $t$
  ($2 \le n \le 2 \times 10^5$, $0 \le t \le 2 \times 10^9$), le nombre de
  membres et le niveau combiné visé.
- La deuxième ligne contient $n$ entiers $v_1, \dots, v_n$
  ($0 \le v_i \le 10^9$), les niveaux des membres.

## Sortie

Le nombre de paires $\{i, j\}$ avec $i < j$ telles que $v_i + v_j = t$.

## Exemples

### Entrée

```
6 10
3 7 5 5 2 8
```

### Sortie

```
3
```

Les trois binômes : $(3, 7)$, $(5, 5)$ et $(2, 8)$.

### Entrée

```
4 20
10 10 10 10
```

### Sortie

```
6
```

Les quatre membres ont le même niveau : chacune des $\binom{4}{2} = 6$ paires
convient. Attention, le nombre de paires peut devenir très grand.
