import fitz
import re
from pathlib import Path

pdf = Path("data_pdfs/Home-40-Small-Full-Songlist-pp1-122-only.pdf")
doc = fitz.open(str(pdf))
text = "\n".join((p.get_text() or "") for p in doc)

checks = [
    ("With A Smile", "1134", "Eraserheads"),
    ("Hotel California", "2581", "Eagles"),
    ("My Way", "2606", "Frank Sinatra"),
    ("Noypi", "7704", "Bamboo"),
    ("Halik", "7280", "Aegis"),
    ("214", "5872", "Rivermaya"),
    ("Through The Years", "1712", "Kenny Rogers"),
    ("Bohemian Rhapsody", "4434", "Queen"),
    ("Careless Whisper", "4188", "George Michael"),
    ("Basang-Basa Sa Ulan", "7269", "Aegis"),
    ("Pare Ko", "1390", "Eraserheads"),
    ("Ang Huling El Bimbo", "3057", "Eraser"),
    ("Tatsulok", "8579", "Bamboo"),
    ("Buko", "15290", "Jireh"),
]

print("PDF pages:", len(doc))
for title, code, artist in checks:
    pattern = re.compile(rf"\b{re.escape(code)}\b")
    matches = list(pattern.finditer(text))
    found = False
    snippet = ""
    title_key = title.lower()
    artist_key = artist.lower()
    for m in matches:
        chunk = text[max(0, m.start() - 100) : m.end() + 100]
        chunk_l = chunk.lower()
        if title_key in chunk_l or artist_key in chunk_l or title.split()[0].lower() in chunk_l:
            found = True
            snippet = " ".join(chunk.split())
            break
    if not found and matches:
        chunk = text[max(0, matches[0].start() - 100) : matches[0].end() + 100]
        snippet = " ".join(chunk.split())
        status = "CODE_EXISTS_CONTEXT_WEAK"
    elif found:
        status = "VERIFIED"
    else:
        status = "NOT_IN_THIS_PDF"
    print(f"{status:24} {code:>5} | {title} | {artist}")
    if snippet:
        print("  ", snippet[:160])
