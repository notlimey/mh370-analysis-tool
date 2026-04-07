#!/usr/bin/env python3
"""
Parse PDFs in knowledge/papers/raw/ to markdown in knowledge/papers/parsed/.
Uses pymupdf (fitz) as primary parser, pdfplumber as fallback.
"""

import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
RAW_DIR = SCRIPT_DIR / "papers" / "raw"
PARSED_DIR = SCRIPT_DIR / "papers" / "parsed"


def detect_repeating_lines(pages_text: list[str], position: str = "header") -> set[str]:
    """
    Detect repeating header/footer lines across pages.
    position: "header" checks first 3 lines, "footer" checks last 3 lines.
    """
    if len(pages_text) < 3:
        return set()

    line_counts: dict[str, int] = {}
    for page_text in pages_text:
        lines = page_text.strip().split("\n")
        if position == "header":
            check_lines = lines[:3]
        else:
            check_lines = lines[-3:]
        for line in check_lines:
            line = line.strip()
            if len(line) > 5:  # skip very short lines
                line_counts[line] = line_counts.get(line, 0) + 1

    # Lines appearing in >50% of pages are likely headers/footers
    threshold = len(pages_text) * 0.5
    return {line for line, count in line_counts.items() if count >= threshold}


def strip_repeating(text: str, repeating: set[str]) -> str:
    """Remove lines that match repeating headers/footers."""
    if not repeating:
        return text
    lines = text.split("\n")
    filtered = [l for l in lines if l.strip() not in repeating]
    return "\n".join(filtered)


def detect_figures(text: str, page_num: int) -> str:
    """Insert figure placeholders where figure references are detected."""
    # Match "Figure X.Y" or "Fig. X.Y" references that appear as standalone lines
    # or near image-like gaps in text
    figure_pattern = re.compile(r"(Figure|Fig\.?)\s+(\d+[\.\-]\d+)", re.IGNORECASE)
    matches = figure_pattern.findall(text)
    # We don't replace inline references, just note them
    return text


def parse_with_pymupdf(pdf_path: Path) -> str | None:
    """Parse PDF using pymupdf (fitz)."""
    try:
        import fitz
    except ImportError:
        print("  pymupdf (fitz) not available")
        return None

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        print(f"  pymupdf failed to open: {e}")
        return None

    # First pass: collect all page texts to detect repeating headers/footers
    pages_text = []
    for page in doc:
        text = page.get_text("text")
        pages_text.append(text)

    repeating_headers = detect_repeating_lines(pages_text, "header")
    repeating_footers = detect_repeating_lines(pages_text, "footer")
    repeating = repeating_headers | repeating_footers

    if repeating:
        print(f"  Detected {len(repeating)} repeating header/footer lines")

    # Second pass: build markdown
    md_parts = []
    md_parts.append(f"# {pdf_path.stem}")
    md_parts.append("")
    md_parts.append(f"Parsed from: `{pdf_path.name}`")
    md_parts.append(f"Pages: {len(doc)}")
    md_parts.append("")

    for page_num, page in enumerate(doc, 1):
        md_parts.append(f"--- Page {page_num} ---")
        md_parts.append("")

        text = pages_text[page_num - 1]
        text = strip_repeating(text, repeating)

        # Detect images on the page
        image_list = page.get_images(full=True)
        if image_list:
            # Check for figure references in text
            fig_pattern = re.compile(r"(Figure|Fig\.?)\s+([\d]+[\.\-]?[\d]*)", re.IGNORECASE)
            fig_matches = fig_pattern.findall(text)
            if fig_matches:
                for _, fig_num in fig_matches:
                    md_parts.append(
                        f"[FIGURE {fig_num} -- page {page_num} -- not extractable as text]"
                    )
            elif len(image_list) > 0:
                md_parts.append(
                    f"[FIGURE -- page {page_num} -- {len(image_list)} image(s) -- not extractable as text]"
                )
            md_parts.append("")

        # Try to detect tables (blocks with tabular structure)
        blocks = page.get_text("blocks")
        has_tables = False
        for block in blocks:
            block_text = block[4] if len(block) > 4 else ""
            if isinstance(block_text, str):
                lines = block_text.strip().split("\n")
                # Heuristic: if multiple lines have similar tab/space patterns, likely a table
                if len(lines) >= 3:
                    tab_lines = sum(1 for l in lines if "\t" in l or l.count("  ") >= 3)
                    if tab_lines >= len(lines) * 0.5:
                        has_tables = True

        if has_tables:
            md_parts.append(f"[TABLE -- page {page_num} -- verify against raw PDF]")
            md_parts.append("")

        # Clean up the text
        text = text.strip()
        if text:
            md_parts.append(text)
        md_parts.append("")

    doc.close()
    return "\n".join(md_parts)


def parse_with_pdfplumber(pdf_path: Path) -> str | None:
    """Fallback parser using pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        print("  pdfplumber not available")
        return None

    try:
        pdf = pdfplumber.open(str(pdf_path))
    except Exception as e:
        print(f"  pdfplumber failed to open: {e}")
        return None

    pages_text = []
    for page in pdf.pages:
        text = page.extract_text() or ""
        pages_text.append(text)

    repeating_headers = detect_repeating_lines(pages_text, "header")
    repeating_footers = detect_repeating_lines(pages_text, "footer")
    repeating = repeating_headers | repeating_footers

    md_parts = []
    md_parts.append(f"# {pdf_path.stem}")
    md_parts.append("")
    md_parts.append(f"Parsed from: `{pdf_path.name}`")
    md_parts.append(f"Pages: {len(pdf.pages)}")
    md_parts.append("")

    for page_num, page in enumerate(pdf.pages, 1):
        md_parts.append(f"--- Page {page_num} ---")
        md_parts.append("")

        text = pages_text[page_num - 1]
        text = strip_repeating(text, repeating)

        tables = page.extract_tables()
        if tables:
            md_parts.append(f"[TABLE -- page {page_num} -- verify against raw PDF]")
            md_parts.append("")

        text = text.strip()
        if text:
            md_parts.append(text)
        md_parts.append("")

    pdf.close()
    return "\n".join(md_parts)


def parse_pdf(pdf_path: Path) -> bool:
    """Parse a single PDF to markdown. Returns True on success."""
    out_path = PARSED_DIR / f"{pdf_path.stem}.md"
    print(f"Parsing {pdf_path.name}...")

    # Try pymupdf first
    result = parse_with_pymupdf(pdf_path)

    # Fall back to pdfplumber
    if result is None:
        print("  Falling back to pdfplumber...")
        result = parse_with_pdfplumber(pdf_path)

    if result is None:
        print(f"  FAILED: No parser could handle {pdf_path.name}")
        return False

    out_path.write_text(result, encoding="utf-8")
    line_count = result.count("\n")
    print(f"  OK: {line_count} lines -> {out_path.name}")
    return True


def main():
    PARSED_DIR.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(RAW_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"No PDFs found in {RAW_DIR}")
        print("Run fetch_sources.py first.")
        sys.exit(1)

    print(f"Found {len(pdfs)} PDFs to parse\n")

    success = 0
    failed = 0
    for pdf in pdfs:
        if parse_pdf(pdf):
            success += 1
        else:
            failed += 1

    print(f"\nDone: {success} parsed, {failed} failed out of {len(pdfs)}")
    if failed > 0:
        print("WARNING: Some PDFs failed to parse.")
        sys.exit(1)


if __name__ == "__main__":
    main()
