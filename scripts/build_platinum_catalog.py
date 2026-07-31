"""Build Platinum Karaoke catalog CSV from official songlist PDFs."""
from __future__ import annotations

import csv
import re
import urllib.request
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "data_pdfs"
OUT_CSV = ROOT / "backend" / "songs" / "data" / "platinum_songs.csv"

URLS = [
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Home-40-Small-Full-Songlist-pp1-122-only.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/P-Series-Volume-61-Additional-List.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/P-Series-Volume-73-Additional-List.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Volume-67-T-X-Series.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Volume-68-T-X-Series.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Volume-73-T-X-Series.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Reyna-Volume-74-Additional-List.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Home-40-Volume-67-Additional-List-6pp-only.pdf",
    "https://platinumkaraoke.ph/wp-content/uploads/2016/08/Home-Nano-Volume-1-additional-songs.pdf",
]

CODE_LINE_RE = re.compile(r"^(\d{3,5})\s*(.*)$")
HEADER_RE = re.compile(
    r"(new songs|platinumkaraoke|vol\.?\s*\d+|p-series|t-series|reyna|"
    r"full songlist|for .+series|opm/pop|home-40|home nano)",
    re.I,
)


def clean(value: str) -> str:
    value = value.replace("\u0000", " ").replace("�", "'")
    return re.sub(r"\s+", " ", value).strip(" -–—|•\t")


def guess_language(title: str, artist: str) -> str:
    text = f"{title} {artist}".lower()
    markers = [
        "ako", "bakit", "ikaw", "pangako", "halik", "buwan", "mahal", "huling",
        "rivermaya", "eraserheads", "bamboo", "ogie", "regine", "sarah geronimo",
        "side a", "apo hiking", "yeng", "gloc", "parokya", "kamikazee", "hale",
        "cueshe", "rocksteddy", "rey valera", "aegis", "siakol", "freestyle",
        "true faith", "afterimage", "hotdog", "pilita", "martin nievera", "gary v",
        "jose mari", "sharon", "vina morales", "brownman", "introvoys",
        "session road", "moonstar", "6cyclemind", "urbandub", "sugarfree",
        "imago", "callalily", "daniel padilla", "moira", "morisette", "jireh",
        "rico blanco", "itchyworms", "silent sanctuary", "pupil", "kjwan",
        "florante", "aiza", "bugoy", "angeline", "julie ann", "willie revillame",
        "james reid", "nadine", "jessa zaragoza", "myd", "kitchie", "nina",
        "christian bautista", "south border", "orange and lemons",
    ]
    if any(m in text for m in markers):
        return "Filipino"
    if re.search(r"\b(ng|ang|sa'yo|sa 'yo|natin|ko na|mo na|pa rin|nangyari)\b", text):
        return "Filipino"
    return "English"


def download(url: str) -> Path | None:
    PDF_DIR.mkdir(exist_ok=True)
    name = url.rstrip("/").split("/")[-1]
    path = PDF_DIR / name
    if path.exists() and path.stat().st_size > 1000:
        return path
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=90).read()
        path.write_bytes(data)
        print(f"downloaded {name} ({len(data)} bytes)")
        return path
    except Exception as exc:
        print(f"skip {name}: {exc}")
        return None


def parse_songlist(path: Path) -> list[tuple[str, str, str]]:
    doc = fitz.open(str(path))
    lines: list[str] = []
    for page in doc:
        for raw in (page.get_text() or "").splitlines():
            line = clean(raw)
            if not line or HEADER_RE.search(line):
                continue
            if re.fullmatch(r"\d{1,2}", line):  # page numbers
                continue
            if re.fullmatch(r"[A-Z]", line) or re.fullmatch(r"0\s*~\s*9", line):
                continue
            lines.append(line)

    songs: list[tuple[str, str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # Numeric titles like "214" look like codes; treat as title if next is CODE+artist
        numeric_title = CODE_LINE_RE.match(line)
        if numeric_title and not clean(numeric_title.group(2)):
            j = i + 1
            if j < len(lines):
                nxt = CODE_LINE_RE.match(lines[j])
                if nxt and clean(nxt.group(2)):
                    title = numeric_title.group(1)
                    code = nxt.group(1)
                    artist_parts = [clean(nxt.group(2))]
                    i = j + 1
                    while i < len(lines):
                        cont = lines[i]
                        if CODE_LINE_RE.match(cont):
                            break
                        if i + 1 < len(lines) and CODE_LINE_RE.match(lines[i + 1]):
                            break
                        if len(cont.split()) <= 6 and len(cont) <= 40:
                            artist_parts.append(cont)
                            i += 1
                        else:
                            break
                    artist = clean(" ".join(artist_parts)) or "Unknown"
                    songs.append((code, title, artist))
                    continue
            i += 1
            continue

        if CODE_LINE_RE.match(line):
            i += 1
            continue

        title_parts = [line]
        i += 1
        while i < len(lines) and not CODE_LINE_RE.match(lines[i]):
            if len(title_parts) >= 4:
                break
            title_parts.append(lines[i])
            i += 1

        if i >= len(lines):
            break

        m = CODE_LINE_RE.match(lines[i])
        if not m:
            continue

        code = m.group(1)
        artist_parts: list[str] = []
        rest = clean(m.group(2))
        if rest:
            artist_parts.append(rest)
        i += 1

        while i < len(lines):
            nxt = lines[i]
            if CODE_LINE_RE.match(nxt):
                break
            # If next line is followed by a code, it's the next title
            if i + 1 < len(lines) and CODE_LINE_RE.match(lines[i + 1]):
                break
            if len(nxt.split()) <= 6 and len(nxt) <= 40:
                artist_parts.append(nxt)
                i += 1
            else:
                break

        title = clean(" ".join(title_parts))
        artist = clean(" ".join(artist_parts)) or "Unknown"

        # Quality filters
        if len(title) < 1 or len(title) > 100:
            continue
        if len(artist) > 80:
            artist = " ".join(artist.split()[:6])
        # Allow numeric titles (e.g. Rivermaya "214"); skip titles that embed other codes
        if re.search(r"\b\d{3,5}\b", title) and not title.isdigit():
            continue
        songs.append((code, title, artist))

    return songs


def main() -> None:
    all_songs: dict[str, tuple[str, str, str, str]] = {}

    for url in URLS:
        path = download(url)
        if not path:
            continue
        parsed = parse_songlist(path)
        print(f"{path.name}: {len(parsed)} songs")
        for code, title, artist in parsed:
            lang = guess_language(title, artist)
            prev = all_songs.get(code)
            if prev is None or (len(title) + len(artist) < len(prev[0]) + len(prev[1])):
                all_songs[code] = (title, artist, lang, "")

    rows = [(c, t, a, lang, g) for c, (t, a, lang, g) in all_songs.items()]
    rows.sort(key=lambda r: (r[1].lower(), r[0]))

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["platinum_number", "title", "artist", "language", "genre"])
        w.writerows(rows)

    print(f"\nTOTAL unique songs: {len(rows)} -> {OUT_CSV}")
    for q in [
        "My Way", "Hotel California", "With A Smile", "Halik", "Noypi",
        "214", "Buko", "Basang", "Pare Ko", "Huling El Bimbo",
        "Careless Whisper", "Everything I Do", "Burnout", "Tatsulok",
        "Kahit Maputi", "Through The Years", "Bohemian",
    ]:
        hits = [(r[0], r[1], r[2]) for r in rows if q.lower() in r[1].lower()]
        print(f"{q}: {hits[:3]}")


if __name__ == "__main__":
    main()
