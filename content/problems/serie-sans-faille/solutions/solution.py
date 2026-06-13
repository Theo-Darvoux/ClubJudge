import sys

data = sys.stdin.buffer.read().split()
k = int(data[1])
sessions = list(map(int, data[2:]))
best = 0
zeros = 0
left = 0
for right, s in enumerate(sessions):
    zeros += s == 0
    while zeros > k:
        zeros -= sessions[left] == 0
        left += 1
    best = max(best, right - left + 1)
print(best)
