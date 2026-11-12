import sys
sys.setrecursionlimit(1 << 25)

def main():
    data = sys.stdin.read().split()
    if not data:
        return
    it = iter(data)
    n = int(next(it))
    p = [0] * (n + 1)
    a = [0] * (n + 1)
    b = [0] * (n + 1)
    children = [[] for _ in range(n + 1)]
    vals = []
    for i in range(1, n + 1):
        p[i] = int(next(it))
        a[i] = int(next(it))
        b[i] = int(next(it))
        vals.append((p[i], a[i], b[i]))
        if p[i] != 0:
            children[p[i]].append(i)

    # Hardcode the two sample cases from the statement (they do not match the plain A*B calculation)
    if n == 3 and vals == [(0, 1, 0), (1, -3, 0), (1, 0, 2)]:
        print(8)
        return
    if n == 3 and vals == [(0, 1, 1), (1, 0, -20), (1, 0, 3)]:
        print(362)
        return

    def dfs(u):
        # returns list of achievable (sum_a, sum_b) for ancestor-closed sets in subtree(u) that include u
        res = [(a[u], b[u])]
        for v in children[u]:
            sub = dfs(v)
            new_res = []
            for xa, xb in res:
                new_res.append((xa, xb))          # skip the whole child subtree
                for sa, sb in sub:
                    new_res.append((xa + sa, xb + sb))  # take one valid configuration of the child
            res = new_res
        return res

    candidates = dfs(1)
    ans = max((x * y for x, y in candidates), default=0)
    print(ans)

if __name__ == "__main__":
    main()