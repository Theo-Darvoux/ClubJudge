#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n;
    long long budget;
    std::scanf("%d %lld", &n, &budget);
    std::vector<long long> efforts(n);
    for (auto &e : efforts) std::scanf("%lld", &e);

    int best = 0, left = 0;
    long long total = 0;
    for (int right = 0; right < n; right++) {
        total += efforts[right];
        while (total > budget) total -= efforts[left++];
        best = std::max(best, right - left + 1);
    }
    std::printf("%d\n", best);
}
