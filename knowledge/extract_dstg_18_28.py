#!/usr/bin/env python3
"""
Extract 18:28 position references from the parsed DSTG book.
Searches for time references, coordinate pairs, and radar fixes
near the key 18:22-18:28 timeframe (last radar contact region).

Output: knowledge/extracted/dstg-18-28-positions.md
"""

import hashlib
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PARSED_DIR = SCRIPT_DIR / "papers" / "parsed"
EXTRACTED_DIR = SCRIPT_DIR / "extracted"
RAW_DIR = SCRIPT_DIR / "papers" / "raw"

DSTG_PARSED = PARSED_DIR / "dstg-book.md"
DSTG_RAW = RAW_DIR / "dstg-book.pdf"

# Search terms
TIME_PATTERNS = ["18:28", "18:25", "18:22", "18:39", "1828", "1825", "1822", "1839"]
COORD_PATTERNS = [
    r"6\.8\s*°?\s*N",
    r"97\.7\s*°?\s*E",
    r"6°\s*48",
    r"97°\s*42",
]
SECTION_PATTERNS = ["10.1", "Section 10", "radar", "last radar", "military radar"]
FIGURE_PATTERN = re.compile(
    r"\[FIGURE\s+([\d\.]+)\s*--\s*page\s+(\d+)", re.IGNORECASE
)

# Coordinate extraction patterns
DECIMAL_COORD = re.compile(
    r"(-?\d+\.?\d*)\s*°?\s*([NSns])\s*[,\s]*(-?\d+\.?\d*)\s*°?\s*([EWew])"
)
DMS_COORD = re.compile(
    r"(\d+)\s*°\s*(\d+)\s*['\u2032]?\s*(\d*\.?\d*)\s*[\"″]?\s*([NSns])\s*[,\s]*"
    r"(\d+)\s*°\s*(\d+)\s*['\u2032]?\s*(\d*\.?\d*)\s*[\"″]?\s*([EWew])"
)


def md5_file(path: Path) -> str:
    if not path.exists():
        return "file-not-found"
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_page_number(text: str, pos: int) -> int:
    """Find the page number for a given character position."""
    page_markers = list(re.finditer(r"--- Page (\d+) ---", text))
    current_page = 0
    for marker in page_markers:
        if marker.start() <= pos:
            current_page = int(marker.group(1))
        else:
            break
    return current_page


def extract_context(text: str, pos: int, window: int = 500) -> str:
    """Extract surrounding context around a position."""
    start = max(0, pos - window)
    end = min(len(text), pos + window)
    context = text[start:end]
    # Clean up page markers for readability
    return context.strip()


def find_coordinates(text: str) -> list[str]:
    """Find coordinate pairs in text."""
    coords = []
    for m in DECIMAL_COORD.finditer(text):
        coords.append(m.group(0))
    for m in DMS_COORD.finditer(text):
        coords.append(m.group(0))
    return coords


def main():
    EXTRACTED_DIR.mkdir(parents=True, exist_ok=True)

    if not DSTG_PARSED.exists():
        print(f"Parsed DSTG book not found at {DSTG_PARSED}")
        print("Run parse_sources.py first.")
        sys.exit(1)

    print("Reading parsed DSTG book...")
    text = DSTG_PARSED.read_text(encoding="utf-8")
    print(f"  {len(text):,} characters, {text.count(chr(10)):,} lines")

    md5 = md5_file(DSTG_RAW)

    output_lines = [
        "# DSTG Book -- 18:28 Position Extraction",
        "",
        f"## Extraction date: {__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()}",
        f"## Source: dstg-book.pdf (MD5: `{md5}`)",
        "",
    ]

    # --- Time references ---
    output_lines.append("## Time reference occurrences")
    output_lines.append("")

    occurrence_num = 0
    for pattern in TIME_PATTERNS:
        positions = [m.start() for m in re.finditer(re.escape(pattern), text, re.IGNORECASE)]
        if positions:
            print(f"  Found {len(positions)} occurrences of '{pattern}'")

        for pos in positions:
            occurrence_num += 1
            page = get_page_number(text, pos)
            context = extract_context(text, pos)
            coords = find_coordinates(context)

            output_lines.append(f"### Occurrence {occurrence_num} -- '{pattern}' -- Page {page}")
            output_lines.append("")
            output_lines.append("```")
            output_lines.append(context)
            output_lines.append("```")
            output_lines.append("")
            if coords:
                output_lines.append(f"**Coordinates found:** {', '.join(coords)}")
            else:
                output_lines.append("**Coordinates found:** None in surrounding text")
            output_lines.append("")

    if occurrence_num == 0:
        output_lines.append("No time references found matching search patterns.")
        output_lines.append("")

    # --- Coordinate searches ---
    output_lines.append("## Known coordinate searches")
    output_lines.append("")

    coord_occurrence = 0
    for pattern in COORD_PATTERNS:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        if matches:
            print(f"  Found {len(matches)} occurrences of '{pattern}'")
        for m in matches:
            coord_occurrence += 1
            page = get_page_number(text, m.start())
            context = extract_context(text, m.start())

            output_lines.append(
                f"### Coord occurrence {coord_occurrence} -- '{pattern}' -- Page {page}"
            )
            output_lines.append("")
            output_lines.append("```")
            output_lines.append(context)
            output_lines.append("```")
            output_lines.append("")

    if coord_occurrence == 0:
        output_lines.append("No known coordinate patterns found.")
        output_lines.append("")

    # --- Section 10.1 and radar references ---
    output_lines.append("## Section 10.1 and radar references")
    output_lines.append("")

    section_occurrence = 0
    for pattern in SECTION_PATTERNS:
        matches = list(re.finditer(re.escape(pattern), text, re.IGNORECASE))
        if matches:
            print(f"  Found {len(matches)} occurrences of '{pattern}'")
        # Only include first 10 to avoid flooding
        for m in matches[:10]:
            section_occurrence += 1
            page = get_page_number(text, m.start())
            context = extract_context(text, m.start(), window=300)

            output_lines.append(
                f"### Section/radar occurrence {section_occurrence} -- '{pattern}' -- Page {page}"
            )
            output_lines.append("")
            output_lines.append("```")
            output_lines.append(context)
            output_lines.append("```")
            output_lines.append("")

    # --- Figure references near 18:28 ---
    output_lines.append("## Figure references near 18:28 time references")
    output_lines.append("")

    # Find all figure placeholders
    figure_matches = list(FIGURE_PATTERN.finditer(text))
    if figure_matches:
        # Check which figures are near time references
        time_positions = []
        for tp in TIME_PATTERNS:
            time_positions.extend(m.start() for m in re.finditer(re.escape(tp), text, re.IGNORECASE))

        nearby_figures = []
        for fig in figure_matches:
            fig_pos = fig.start()
            for tp in time_positions:
                if abs(fig_pos - tp) < 3000:  # within ~3000 chars
                    nearby_figures.append(fig)
                    break

        if nearby_figures:
            for fig in nearby_figures:
                output_lines.append(
                    f"- Figure {fig.group(1)} on page {fig.group(2)} "
                    f"(near time reference)"
                )
        else:
            output_lines.append("No figure placeholders found near time references.")

        output_lines.append("")
        output_lines.append("### All figures in document")
        output_lines.append("")
        for fig in figure_matches:
            output_lines.append(f"- Figure {fig.group(1)} -- page {fig.group(2)}")
    else:
        output_lines.append("No figure placeholders found in parsed text.")

    output_lines.append("")

    # --- Conclusion ---
    output_lines.append("## Conclusion")
    output_lines.append("")

    if occurrence_num > 0 or coord_occurrence > 0:
        has_coords_in_text = any(
            find_coordinates(extract_context(text, m.start()))
            for tp in TIME_PATTERNS
            for m in re.finditer(re.escape(tp), text, re.IGNORECASE)
        )
        if has_coords_in_text:
            output_lines.append(
                "Coordinates were found in the text near time references. "
                "Cross-reference with the raw PDF to verify accuracy."
            )
        else:
            output_lines.append(
                "Time references were found but no explicit coordinates appeared in the "
                "surrounding text. The 18:28 position data is likely contained in figures "
                "rather than text. Check the figures listed above against the raw PDF."
            )
    else:
        output_lines.append(
            "Neither time references nor coordinates were found. "
            "The parsed text may not have extracted the relevant sections. "
            "Manual inspection of the raw PDF is required."
        )

    output_lines.append("")
    output_lines.append(
        "**Manual verification required:** Always cross-reference extracted data "
        "with the original PDF, especially for coordinates that may appear in "
        "figures or tables that could not be reliably text-extracted."
    )
    output_lines.append("")

    # Write output
    out_path = EXTRACTED_DIR / "dstg-18-28-positions.md"
    out_path.write_text("\n".join(output_lines), encoding="utf-8")
    print(f"\nOutput written to {out_path}")
    print(f"  {occurrence_num} time occurrences, {coord_occurrence} coordinate occurrences found")


if __name__ == "__main__":
    main()
