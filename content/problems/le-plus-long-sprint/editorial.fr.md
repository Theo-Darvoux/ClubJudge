« La plus longue plage de jours consécutifs telle que… » : ce libellé appelle
une **fenêtre glissante** (deux pointeurs). C'est la technique reine pour les
questions de sous-tableaux contigus quand une certaine monotonie s'y prête.

## L'observation qui autorise la fenêtre

Les énergies sont positives ou nulles, donc élargir une fenêtre ne peut
qu'augmenter (ou maintenir) sa somme. Conséquence : si $[g, d]$ dépasse le
budget, inutile d'essayer $[g, d+1]$, $[g, d+2]$… — **quand le bord droit
avance, le bord gauche n'a jamais besoin de reculer**. C'est cette propriété,
et elle seule, qui rend les deux pointeurs corrects.

## L'algorithme

On avance le bord droit jour par jour. La somme de la fenêtre est maintenue
au fil de l'eau ; si elle dépasse $B$, on resserre par la gauche jusqu'à
revenir dans le budget. La fenêtre courante est alors **la plus longue
fenêtre valide se terminant en $d$** :

```python
import sys

data = sys.stdin.buffer.read().split()
budget = int(data[1])
efforts = list(map(int, data[2:]))
best = 0
total = 0
left = 0
for right, cost in enumerate(efforts):
    total += cost
    while total > budget:
        total -= efforts[left]
        left += 1
    best = max(best, right - left + 1)
print(best)
```

Le `while` intérieur fait peur, mais chaque jour n'est « expulsé » de la
fenêtre qu'une seule fois : les deux bords font $n$ pas chacun au total, soit
$O(n)$ — contre $O(n^2)$ fenêtres à tester naïvement.

```cpp
int best = 0, left = 0;
long long total = 0;
for (int right = 0; right < n; right++) {
    total += efforts[right];
    while (total > budget) total -= efforts[left++];
    best = std::max(best, right - left + 1);
}
```

## Les pièges

- **Les jours à $0$** : ils s'ajoutent gratuitement à la fenêtre — le cas
  $B = 0$ avec des $e_i = 0$ doit marcher (test 2).
- **La réponse $0$** : si un jour coûte plus que $B$ à lui seul, le `while`
  vide entièrement la fenêtre (`left = right + 1`) et la longueur courante
  vaut $0$ d'elle-même — pas de cas particulier si le code est bien écrit.
- **Le débordement** : $\sum e_i$ atteint $2 \times 10^{14}$ — `long long`.
- **Des valeurs négatives ?** Toute la correction repose sur $e_i \ge 0$.
  Avec des négatifs, reculer le bord gauche pourrait redevenir intéressant et
  la technique s'effondre — il faudrait d'autres outils (préfixes + minimum
  courant, cf. « La meilleure semaine »).

À retenir : *plus long sous-tableau contigu sous contrainte monotone* =
fenêtre glissante en $O(n)$. Vérifiez toujours la monotonie avant de
l'appliquer.
