import re
import urllib.request
from html.parser import HTMLParser

url = "https://platinumkaraoke.ph/updates/Songlist%20Update.html"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")

hrefs = re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.I)
for h in hrefs:
    lower = h.lower()
    if any(x in lower for x in ["pdf", "song", "volume", "vol", "update"]):
        print(h)
