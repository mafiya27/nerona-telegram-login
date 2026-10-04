#!/usr/bin/env python3
"""NERONA proxy pool health checker — runs on GitHub Actions (free tier).

Reads the proxy pool from the license server, tests each proxy concurrently
by routing a request through it, and POSTs the results back. Also pings the
license server + Supabase so the free tiers don't go to sleep.

Env:
  LICENSE_API_BASE    e.g. https://nerona-telegram-login.vercel.app
  LICENSE_ADMIN_SECRET  the ADMIN_SECRET from Vercel env
  PROXY_TIMEOUT         seconds per proxy test (default 20)
  MAX_WORKERS           concurrent tests (default 20)
"""
import concurrent.futures
import json
import os
import subprocess
import sys
import time
import urllib.request

API_BASE = os.environ.get("LICENSE_API_BASE", "").rstrip("/")
ADMIN_SECRET = os.environ.get("LICENSE_ADMIN_SECRET", "")
TIMEOUT = int(os.environ.get("PROXY_TIMEOUT", "20"))
WORKERS = int(os.environ.get("MAX_WORKERS", "20"))


def api(method, path, body=None, query=""):
    url = API_BASE + path + query
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Admin-Secret": ADMIN_SECRET,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        print(f"API {method} {path} failed: {e}", flush=True)
        return None


def test_proxy(entry):
    """Route one request through the proxy; return a result dict."""
    host = entry["host"]
    port = entry["port"]
    protocol = (entry.get("protocol") or "http").lower()
    proxy_url = f"{protocol}://{host}:{port}"
    # https://ip-api.com/json/?fields=... returns caller IP + country in one hit
    target = "https://ip-api.com/json/?fields=status,country,countryCode,query"
    t0 = time.time()
    try:
        out = subprocess.run(
            ["curl", "-sS", "--max-time", str(TIMEOUT),
             "-x", proxy_url, target],
            capture_output=True, text=True, timeout=TIMEOUT + 5,
        )
        ms = int((time.time() - t0) * 1000)
        if out.returncode != 0:
            return {"host": host, "port": port, "protocol": protocol,
                    "status": "dead", "latency_ms": None, "country": None}
        data = json.loads(out.stdout or "{}")
        if data.get("status") == "success" and data.get("query"):
            return {"host": host, "port": port, "protocol": protocol,
                    "status": "active", "latency_ms": ms,
                    "country": (data.get("countryCode") or "").upper() or None}
        return {"host": host, "port": port, "protocol": protocol,
                "status": "dead", "latency_ms": None, "country": None}
    except Exception:  # noqa: BLE001
        return {"host": host, "port": port, "protocol": protocol,
                "status": "dead", "latency_ms": None, "country": None}


def main():
    if not API_BASE or not ADMIN_SECRET:
        print("LICENSE_API_BASE and LICENSE_ADMIN_SECRET are required", flush=True)
        return 2

    # 1. keep-alive: any request wakes Vercel + Supabase
    api("POST", "/api/session", {"session": "ping"})
    print("keep-alive ping sent", flush=True)

    # 2. fetch the pool
    pool = api("GET", "/api/admin/proxies", query="?limit=500")
    proxies = (pool or {}).get("proxies") or []
    print(f"pool has {len(proxies)} proxies", flush=True)
    if not proxies:
        return 0

    # 3. test concurrently
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(test_proxy, p): p for p in proxies}
        for f in concurrent.futures.as_completed(futs):
            results.append(f.result())
    active = sum(1 for r in results if r["status"] == "active")
    print(f"tested {len(results)}: {active} active, {len(results) - active} dead", flush=True)

    # 4. report back
    out = api("POST", "/api/admin/proxy-health", {"results": results})
    if out and out.get("ok"):
        print(f"reported {out.get('updated')} results", flush=True)
        return 0
    print("failed to report results", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
