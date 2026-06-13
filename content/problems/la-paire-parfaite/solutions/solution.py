from collections import Counter

_, t = map(int, input().split())
seen = Counter()
pairs = 0
for v in map(int, input().split()):
    pairs += seen[t - v]
    seen[v] += 1
print(pairs)
