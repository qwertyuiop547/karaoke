"""Parse Platinum Vol.59 by pairing title/code blocks on the same row."""
from __future__ import annotations

import csv
import re
from pathlib import Path

import fitz

PDF_PATH = Path(__file__).resolve().parents[1] / "vol59.pdf"
OUT_CSV = Path(__file__).resolve().parents[1] / "backend" / "songs" / "data" / "platinum_vol59.csv"

CODE_ARTIST_RE = re.compile(r"^(\d{3,5})\s+(.+)$")


def clean(value: str) -> str:
    value = value.replace("\u0000", " ").replace("�", "'")
    value = re.sub(r"\s+", " ", value).strip()
    for pat in [
        r"No Magic,?\s*Pure Technology",
        r"platinumkaraoke\.ph",
        r"!?Vol\.?\s*\d+\s*P-series",
        r"\d?\s*Full Songlist",
    ]:
        value = re.sub(pat, "", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip(" -–—|•")


def guess_language(title: str, artist: str) -> str:
    text = f"{title} {artist}".lower()
    markers = [
        "ako", "bakit", "ikaw", "pangako", "halik", "buwan", "mahal", "huling",
        "rivermaya", "eraserheads", "bamboo", "ogie", "regine", "sarah geronimo",
        "side a", "apo hiking", "yeng", "gloc", "parokya", "kamikazee", "hale",
        "cueshe", "rocksteddy", "rey valera", "aegis", "siakol", "freestyle",
        "true faith", "afterimage", "hotdog", "pilita", "martin nievera", "gary v",
        "jose mari", "sharon", "aleck bovick", "vina morales", "brownman",
        "introvoys", "session road", "south border", "moonstar", "6cyclemind",
        "urbandub", "sugarfree", "imago", "orange and lemons", "callalily",
        "renz verano", "christian bautista", "kitchie", "myd", "silent sanctuary",
    ]
    if any(m in text for m in markers):
        return "Filipino"
    if re.search(r"\b(ng|ang|sa'yo|sa 'yo|natin|ko na|mo na|pa rin)\b", text):
        return "Filipino"
    return "English"


def col_of(x0: float, width: float) -> int:
    if x0 < width / 3:
        return 0
    if x0 < 2 * width / 3:
        return 1
    return 2


def parse_page(page: fitz.Page) -> list[tuple[str, str, str]]:
    width = page.rect.width
    blocks = []
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, text, *_ = b
        text = clean(text)
        if not text:
            continue
        if re.fullmatch(r"[A-Z]", text) or re.fullmatch(r"0\s*~\s*9", text):
            continue
        low = text.lower()
        if any(n in low for n in ["full songlist", "platinumkaraoke", "p-series", "vol."]):
            continue
        blocks.append(
            {
                "col": col_of(x0, width),
                "y": round(y0 / 4) * 4,
                "x": x0,
                "text": text,
            }
        )

    songs = []
    for col in (0, 1, 2):
        col_blocks = sorted([b for b in blocks if b["col"] == col], key=lambda b: (b["y"], b["x"]))
        # Group by y band
        bands: dict[int, list] = {}
        for b in col_blocks:
            bands.setdefault(b["y"], []).append(b)

        pending_title = []
        for y in sorted(bands):
            band = sorted(bands[y], key=lambda b: b["x"])
            title_parts = []
            code_parts = []
            for b in band:
                if CODE_ARTIST_RE.match(b["text"]):
                    code_parts.append(b["text"])
                else:
                    title_parts.append(b["text"])

            if code_parts:
                title = clean(" ".join(pending_title + title_parts))
                pending_title = []
                for cp in code_parts:
                    m = CODE_ARTIST_RE.match(cp)
                    if not m:
                        continue
                    code, artist = m.group(1), clean(m.group(2))
                    # Artist often truncated mid-name across lines; OK
                    if title and artist and len(title) >= 2:
                        songs.append((code, title, artist))
                        title = ""  # only first code gets this title
                # If multiple codes in band without separate titles, skip extras without title
            else:
                if title_parts:
                    pending_title.extend(title_parts)
                    if len(pending_title) > 5:
                        pending_title = pending_title[-5:]
    return songs


def main() -> None:
    doc = fitz.open(str(PDF_PATH))
    songs: dict[str, tuple[str, str, str, str]] = {}

    for page in doc:
        for code, title, artist in parse_page(page):
            title, artist = clean(title), clean(artist)
            if len(title) < 2 or len(artist) < 2:
                continue
            if sum(c.isalpha() for c in title) < 2:
                continue
            # Keep artist reasonably short
            tokens = artist.split()
            if len(tokens) > 5:
                artist = " ".join(tokens[:5])
            songs[code] = (title, artist, guess_language(title, artist), "")

    rows = [(c, t, a, lang, g) for c, (t, a, lang, g) in songs.items()]
    rows.sort(key=lambda r: (r[1].lower(), r[0]))

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["platinum_number", "title", "artist", "language", "genre"])
        w.writerows(rows)

    print(f"Parsed {len(rows)} songs")
    for q in [
        "My Way", "Hotel California", "With A Smile", "Halik", "Noypi",
        "Bohemian", "Careless Whisper", "Basang", "Tatsulok", "Kahit Maputi",
        "214", "Everything I Do", "Billie Jean", "Pare Ko", "Ang Huling",
        "Through The Years", "Wonderwall", "Shape Of You",
    ]:
        hits = [(r[0], r[1], r[2]) for r in rows if q.lower() in r[1].lower()]
        print(f"{q}: {hits[:2]}")


if __name__ == "__main__":
    main()
