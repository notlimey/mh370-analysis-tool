#!/usr/bin/env python3
"""
Download primary source PDFs for MH370 analysis.
Outputs: knowledge/papers/raw/<filename>.pdf
Generates: knowledge/sources.md with checksums and status.
"""

import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' package required. Install with: pip install requests")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
RAW_DIR = SCRIPT_DIR / "papers" / "raw"
SOURCES_MD = SCRIPT_DIR / "sources.md"

SOURCES = [
    {
        "filename": "dstg-book.pdf",
        "url": "https://library.oapen.org/bitstream/handle/20.500.12657/27976/1/1002023.pdf",
        "description": "DSTG Book: Bayesian Methods in the Search for MH370 (OAPEN open-access mirror)",
    },
    {
        "filename": "atsb-underwater-search-areas-dec2015.pdf",
        "url": "https://www.atsb.gov.au/sites/default/files/2022-12/AE-2014-054_MH370-Definition%20of%20Underwater%20Search%20Areas_3Dec2015.pdf",
        "description": "ATSB Definition of Underwater Search Areas (Dec 2015 update)",
    },
    {
        "filename": "atsb-search-and-debris-update-nov2016.pdf",
        "url": "https://www.atsb.gov.au/sites/default/files/media/5771939/ae-2014-054_mh370-search-and-debris-update_2nov-2016_v2.pdf",
        "description": "ATSB MH370 Search and Debris Examination Update Nov 2016",
    },
    {
        "filename": "atsb-operational-search-final-oct2017.pdf",
        "url": "https://www.atsb.gov.au/sites/default/files/media/5773565/operational-search-for-mh370_final_3oct2017.pdf",
        "description": "ATSB Operational Search for MH370 Final Report Oct 2017",
    },
    {
        "filename": "malaysia-safety-investigation-report-2018.pdf",
        "url": "https://www.mot.gov.my/en/MH370%20Investigation%20Report/01-Report/MH370SafetyInvestigationReport.pdf",
        "description": "Malaysian Safety Investigation Report July 2018",
    },
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_pdf(path: Path) -> bool:
    """Check file is non-empty and starts with PDF magic bytes."""
    if path.stat().st_size == 0:
        return False
    with open(path, "rb") as f:
        header = f.read(5)
    return header == b"%PDF-"


def download_source(source: dict) -> dict:
    """Download a single source. Returns result dict."""
    filename = source["filename"]
    url = source["url"]
    dest = RAW_DIR / filename
    result = {
        "filename": filename,
        "url": url,
        "description": source["description"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "failed",
        "size_bytes": 0,
        "md5": "",
        "error": "",
    }

    print(f"Downloading {filename}...")
    print(f"  URL: {url}")

    try:
        resp = requests.get(url, timeout=60, allow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (research tool; MH370 analysis)"
        })
        resp.raise_for_status()

        dest.write_bytes(resp.content)
        size = dest.stat().st_size
        result["size_bytes"] = size

        if size == 0:
            result["error"] = "Downloaded file is empty (0 bytes)"
            print(f"  FAILED: {result['error']}")
            return result

        if not verify_pdf(dest):
            result["error"] = "File does not have valid PDF header (%PDF-)"
            print(f"  FAILED: {result['error']}")
            return result

        result["md5"] = md5_file(dest)
        result["status"] = "success"
        print(f"  OK: {size:,} bytes, MD5: {result['md5']}")

    except requests.exceptions.RequestException as e:
        result["error"] = str(e)
        print(f"  FAILED: {e}")

    return result


def write_sources_md(results: list[dict]):
    """Write sources.md manifest."""
    lines = [
        "# Source Documents",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "| Filename | Description | Size | MD5 | Status |",
        "|----------|-------------|------|-----|--------|",
    ]

    for r in results:
        size_str = f"{r['size_bytes']:,} bytes" if r["size_bytes"] > 0 else "—"
        md5_str = r["md5"] if r["md5"] else "—"
        status_str = r["status"]
        if r["error"]:
            status_str += f" ({r['error'][:60]})"
        lines.append(
            f"| {r['filename']} | {r['description']} | {size_str} | `{md5_str}` | {status_str} |"
        )

    lines.append("")
    lines.append("## URLs")
    lines.append("")
    for r in results:
        lines.append(f"- **{r['filename']}**: {r['url']}")

    lines.append("")

    SOURCES_MD.write_text("\n".join(lines))
    print(f"\nManifest written to {SOURCES_MD}")


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    success = 0
    failed = 0

    for source in SOURCES:
        result = download_source(source)
        results.append(result)
        if result["status"] == "success":
            success += 1
        else:
            failed += 1

    write_sources_md(results)

    print(f"\nDone: {success} succeeded, {failed} failed out of {len(SOURCES)}")
    if failed > 0:
        print("WARNING: Some downloads failed. Check sources.md for details.")
        sys.exit(1)


if __name__ == "__main__":
    main()
