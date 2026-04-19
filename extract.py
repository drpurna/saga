import urllib.parse
import requests
from bs4 import BeautifulSoup

URL = "https://yupptv.yecic62314.workers.dev"
OUTPUT_FILE = "channels.m3u"

def fetch_and_extract():
    resp = requests.get(URL)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    channels = []
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]
        if "dtv=" in href:
            parsed = urllib.parse.urlparse(href)
            params = urllib.parse.parse_qs(parsed.query)
            encoded = params.get("dtv", [None])[0]
            if encoded:
                stream_url = urllib.parse.unquote(encoded)
                name = a_tag.get_text(strip=True)
                if not name:
                    name = a_tag.get("title") or a_tag.get("alt") or "Unknown"
                channels.append((name, stream_url))

    seen = set()
    unique_channels = []
    for name, url in channels:
        if url not in seen:
            seen.add(url)
            unique_channels.append((name, url))

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        for name, url in unique_channels:
            clean_name = " ".join(name.split())
            f.write(f'#EXTINF:-1 tvg-name="{clean_name}", {clean_name}\n')
            f.write(f"{url}\n")

    print(f"✅ Saved {len(unique_channels)} channels to {OUTPUT_FILE}")

if __name__ == "__main__":
    fetch_and_extract()