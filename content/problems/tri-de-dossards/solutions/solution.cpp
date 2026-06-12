#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n;
    std::scanf("%d", &n);
    std::vector<long long> d(n);
    for (auto& x : d) std::scanf("%lld", &x);
    std::sort(d.begin(), d.end());
    for (int i = 0; i < n; i++) std::printf("%lld%c", d[i], i + 1 < n ? ' ' : '\n');
}
