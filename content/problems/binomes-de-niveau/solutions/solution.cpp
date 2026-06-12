#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n;
    std::scanf("%d", &n);
    std::vector<long long> v(n);
    for (auto &x : v) std::scanf("%lld", &x);
    std::sort(v.begin(), v.end());
    long long best = v[1] - v[0];
    for (int i = 2; i < n; i++) best = std::min(best, v[i] - v[i - 1]);
    std::printf("%lld\n", best);
}
