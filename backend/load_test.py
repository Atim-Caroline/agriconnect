"""Small standard-library HTTP load test for the local AgriConnect prototype."""

import argparse
import concurrent.futures
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter


def request_once(url, timeout):
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
        error.read()
    except (OSError, TimeoutError):
        status = 0
    return status, (time.perf_counter() - started) * 1000


def percentile(samples, fraction):
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def run_case(url, count, clients, timeout):
    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=clients) as pool:
        results = list(pool.map(lambda _: request_once(url, timeout), range(count)))
    elapsed = time.perf_counter() - started
    latencies = [latency for _, latency in results]
    successes = sum(200 <= status < 300 for status, _ in results)
    failures = count - successes
    status_counts = ";".join(
        f"{status}:{number}"
        for status, number in sorted(Counter(status for status, _ in results).items())
    )
    print(
        f"{count},{clients},{successes},{failures},"
        f"{statistics.mean(latencies):.2f},{percentile(latencies, 0.50):.2f},"
        f"{percentile(latencies, 0.95):.2f},{max(latencies):.2f},"
        f"{count / elapsed:.2f},{status_counts}"
    )
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8080/api/v1/health/",
        help="Read-only endpoint; defaults to the load-balanced health check.",
    )
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--clients", default="1,10", help="Comma-separated concurrency levels.")
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()
    clients = [int(value) for value in args.clients.split(",")]
    if args.requests < 1 or any(value < 1 for value in clients):
        parser.error("--requests and every --clients value must be positive.")

    print(
        "requests,clients,successes,failures,mean_ms,p50_ms,p95_ms,max_ms,"
        "requests_per_second,status_counts"
    )
    failures = sum(
        run_case(args.url, args.requests, concurrency, args.timeout)
        for concurrency in clients
    )
    if failures:
        raise SystemExit(f"{failures} request(s) failed; see the result rows above.")


if __name__ == "__main__":
    main()
