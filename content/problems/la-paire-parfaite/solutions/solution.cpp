#include <cstdio>
#include <unordered_map>

int main() {
    int n;
    long long t;
    std::scanf("%d %lld", &n, &t);
    std::unordered_map<long long, long long> seen;
    seen.reserve(2 * n);
    long long pairs = 0;
    for (int i = 0; i < n; i++) {
        long long v;
        std::scanf("%lld", &v);
        auto it = seen.find(t - v);
        if (it != seen.end()) pairs += it->second;
        seen[v]++;
    }
    std::printf("%lld\n", pairs);
}
