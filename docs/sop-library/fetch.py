"""Download pending items in manifest.json into this folder.

Usage: python fetch.py            (downloads everything still pending)
       python fetch.py --id elisa-xia
Standard library only; works on Windows and Linux.
"""
import argparse, datetime, hashlib, json, pathlib, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
UA = "Mozilla/5.0 (AILaboratory test-set fetcher)"

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", action="append")
    args = ap.parse_args()
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failed = 0
    for it in data["items"]:
        if args.id and it["id"] not in args.id:
            continue
        if it["status"] == "saved" or not it.get("download"):
            continue
        dest = ROOT / it["local_files"][0]
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            req = urllib.request.Request(it["download"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                ctype = r.headers.get("Content-Type", "")
            if it["format"] == "pdf" and not body.startswith(b"%PDF"):
                raise ValueError(f"expected a PDF, got {ctype or 'unknown type'}")
            dest.write_bytes(body)
            it["status"] = "saved"
            it["retrieved"] = datetime.date.today().isoformat()
            it["sha256"] = hashlib.sha256(body).hexdigest()
            it["bytes"] = len(body)
            print(f"saved  {it['id']}  ({len(body)} bytes)")
        except Exception as e:  # report and continue with the rest
            failed += 1
            print(f"FAILED {it['id']}: {e}", file=sys.stderr)
    MANIFEST.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
