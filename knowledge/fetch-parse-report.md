# Knowledge Base Fetch/Parse/Extract Report

Generated: 2026-04-07

## Step 1 — Directory Structure

Created `knowledge/` with `papers/raw/`, `papers/parsed/`, `extracted/` subdirectories.
Added `knowledge/papers/raw/`, `knowledge/papers/parsed/`, `knowledge/extracted/`, and `knowledge/.venv/` to `.gitignore`.
Scripts and documentation are committed.

## Step 2 — Source Fetching

| Filename | Status | Size | Notes |
|----------|--------|------|-------|
| dstg-book.pdf | SUCCESS | 6,898,866 bytes | OAPEN open-access mirror (original DST URL returned 404) |
| atsb-underwater-search-areas-dec2015.pdf | FAILED | — | ATSB site timing out from this network |
| atsb-search-and-debris-update-nov2016.pdf | FAILED | — | ATSB site timing out from this network |
| atsb-operational-search-final-oct2017.pdf | FAILED | — | ATSB site timing out from this network |
| malaysia-safety-investigation-report-2018.pdf | SUCCESS | 8,399,521 bytes | Malaysian MOT site |

**ATSB downloads:** All three ATSB URLs use the new site structure (`/sites/default/files/...`) which Google has indexed, but the site is unreachable from this network (connection timeout). These are valid URLs — retry from a different network or use a VPN.

## Step 3 — PDF Parsing

| Filename | Lines | Notes |
|----------|-------|-------|
| dstg-book.md | 5,941 | Clean parse via pymupdf. Figures detected as placeholders. |
| malaysia-safety-investigation-report-2018.md | 23,292 | 2 repeating header/footer lines stripped. |

## Step 4 — 18:28 Position Extraction

**Source:** dstg-book.pdf (MD5: `0f12d64b48a21c8ff81fa43442d9976b`)

### Results

- **64 time reference occurrences** found (17× "18:28", 18× "18:25", 14× "18:22", 15× "18:39")
- **0 explicit coordinate pairs** found in surrounding text
- **12 figures near time references** identified

### Key Finding

The DSTG book discusses the 18:22-18:28 timeframe extensively in Chapter 4 ("Aircraft Prior Based on Primary Radar Data") and Chapter 10 ("The Filter Applied to the Accident Flight"), but **coordinates are embedded in figures, not text**. The relevant figures are:

| Figure | Page | Relevance |
|--------|------|-----------|
| Figure 4.1 | 33 | Radar track visualization |
| Figure 4.3 | 35 | Prior predictions 18:02-18:25 with azimuth fan |
| Figure 10.1 | 100 | Set of paths from 18:02 to 00:19 (BTO weighting only) |
| Figure 10.2 | 101 | Near time references |
| Figure 10.5 | 104 | Near time references |
| Figure 10.6 | 104 | Near time references |
| Figure 10.7 | 105 | Near time references |

### Textual Context Found

Key passages extracted (Chapter 4, pages 33-35):
- "the aircraft did not turn between 18:02 and 18:22, but the numerical values were not used"
- "a prior was defined at 18:01 at the penultimate radar point using the output of the Kalman filter"
- "position standard deviations were set to 0.5nm and the direction standard deviation to 1°"
- "The 18:22 radar point, at the end of the radar track, is clearly within the azimuth fan"
- "the filtered speed at the output of the Kalman filter is not consistent with the 18:25 measurement"

### Action Required

To extract the 18:28 position coordinates, **manually inspect these pages in the raw PDF**:
1. **Page 33 (Figure 4.1)** — likely shows the radar track with lat/lon grid
2. **Page 35 (Figure 4.3)** — shows prior predictions with the 18:22 radar point
3. **Page 100 (Figure 10.1)** — paths from 18:02 onward

The known 18:22 radar fix (6.8°N, 97.7°E) was not found as text in the parsed output — it appears only in figures.

## Step 5 — Verification

- **Rust tests:** All 36 tests pass (exit code 0)
- **Scripts:** All three scripts run without error
- **knowledge/README.md:** Coherent, explains rebuild process
- **knowledge/sources.md:** Generated with download results
- **Extraction output:** Written to `knowledge/extracted/dstg-18-28-positions.md`
