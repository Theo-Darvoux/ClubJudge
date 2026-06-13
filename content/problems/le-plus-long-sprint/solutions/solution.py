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
