# Entrées et sorties

Tout problème de la plateforme suit le même contrat : votre programme lit des
données sur l'**entrée standard** (stdin), calcule, et écrit sa réponse sur la
**sortie standard** (stdout). Pas de fichiers, pas de saisie interactive — le
juge fournit l'entrée et compare votre sortie à celle attendue.

C'est le rituel de base, et il s'apprend en cinq minutes.

## Lire l'entrée

L'énoncé décrit toujours précisément le format de l'entrée. Par exemple :
« la première ligne contient deux entiers $a$ et $b$ séparés par un espace ».

En Python, `input()` lit une ligne ; `split()` la découpe sur les espaces :

```python
a, b = map(int, input().split())
print(a + b)
```

En C++, `std::cin` saute tout seul espaces et retours à la ligne — lire deux
entiers est identique qu'ils soient sur une ou deux lignes :

```cpp
#include <bits/stdc++.h>

int main() {
    long long a, b;
    std::cin >> a >> b;
    std::cout << a + b << "\n";
}
```

Deux pièges classiques de débutant :

- **Ne lisez que ce que l'énoncé décrit.** Pas de `input("Entrez a : ")` —
  le texte de l'invite serait écrit sur stdout et comparé à la sortie attendue.
- **Attention aux bornes.** Si l'énoncé annonce des valeurs jusqu'à $10^{18}$,
  un `int` C++ déborde : prenez `long long`. Python, lui, ne déborde jamais.

## Écrire la sortie

Écrivez exactement ce que demande l'énoncé, rien de plus. Le juge tolère les
espaces et retours à la ligne en fin de sortie, mais pas un « La réponse est »
devant le nombre.

Quand il y a plusieurs valeurs à écrire, respectez le séparateur demandé
(espace ou retour à la ligne) — c'est la première cause de « Mauvaise
réponse » qui n'en est pas une.

## À vous

Le problème ci-dessous est le « hello world » de la plateforme : lisez deux
entiers, écrivez leur somme. Utilisez le bouton « Tester sur les exemples »
autant que vous voulez — ça ne compte pas comme une soumission.

```tp
deux-sommes
```

## Pour aller plus loin

Sur de très grosses entrées ($10^6$ nombres et plus), la lecture elle-même
peut coûter cher. Deux réflexes à connaître — inutiles sur les petits
problèmes, indispensables plus tard :

```python
import sys
data = sys.stdin.buffer.read().split()  # bien plus rapide que input() en boucle
```

```cpp
std::ios_base::sync_with_stdio(false);  // au début de main()
std::cin.tie(nullptr);
```
