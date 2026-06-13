Le foyer affiche les prix de tous ses snacks, en centimes. Les membres posent
sans arrêt la même question : « qu'est-ce que je peux m'offrir entre $a$ et
$b$ centimes ? ». Écrivez le programme qui répond — vite, parce qu'il y a
beaucoup de questions.

## Entrée

- La première ligne contient deux entiers $n$ et $q$
  ($1 \le n, q \le 10^5$), le nombre de snacks et le nombre de questions.
- La deuxième ligne contient $n$ entiers $p_1, \dots, p_n$
  ($0 \le p_i \le 10^9$), les prix des snacks.
- Chacune des $q$ lignes suivantes contient deux entiers $a$ et $b$
  ($0 \le a \le b \le 10^9$), une question.

## Sortie

Pour chaque question, dans l'ordre, le nombre de snacks dont le prix $p_i$
vérifie $a \le p_i \le b$, sur sa propre ligne.

## Exemple

### Entrée

```
5 3
40 90 40 70 120
40 90
50 60
1 1000
```

### Sortie

```
4
0
5
```

Entre $40$ et $90$ centimes : les deux snacks à $40$, celui à $70$ et celui à
$90$, soit $4$. Les bornes sont incluses, et deux snacks peuvent avoir le même
prix.
