import bisect
import sys

data = sys.stdin.buffer.read().split()
n, q = int(data[0]), int(data[1])
prices = sorted(map(int, data[2 : 2 + n]))
out = []
pos = 2 + n
for _ in range(q):
    a, b = int(data[pos]), int(data[pos + 1])
    pos += 2
    out.append(bisect.bisect_right(prices, b) - bisect.bisect_left(prices, a))
sys.stdout.write("\n".join(map(str, out)) + "\n")
