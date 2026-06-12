La cafétéria du club note chaque jour son bilan : positif les jours de vente
de crêpes, négatif les jours où la machine à café tombe en panne. Le trésorier
veut connaître la meilleure période de l'histoire du club : la séquence de
jours **consécutifs** dont la somme des bilans est maximale.

## Entrée

- La première ligne contient un entier $n$ ($1 \le n \le 10^5$), le nombre de jours.
- La deuxième ligne contient $n$ entiers $b_1, \dots, b_n$
  ($-10^4 \le b_i \le 10^4$), les bilans quotidiens.

## Sortie

Un seul entier : la somme maximale d'une sous-séquence contiguë **non vide**
de $b$.

## Exemples

### Entrée

```
8
-2 1 -3 4 -1 2 1 -5
```

### Sortie

```
6
```

La meilleure période est $[4, -1, 2, 1]$, de somme $6$.

### Entrée

```
3
-5 -1 -8
```

### Sortie

```
-1
```

Même quand toutes les semaines sont mauvaises, il faut bien en choisir une :
la sous-séquence ne peut pas être vide.
