#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n, k;
    std::scanf("%d %d", &n, &k);
    std::vector<int> sessions(n);
    for (auto &s : sessions) std::scanf("%d", &s);

    int best = 0, left = 0, zeros = 0;
    for (int right = 0; right < n; right++) {
        zeros += sessions[right] == 0;
        while (zeros > k) zeros -= sessions[left++] == 0;
        best = std::max(best, right - left + 1);
    }
    std::printf("%d\n", best);
}
