#!/usr/bin/env python3
"""페이지에 쓰는 글자만 담은 폰트 파일을 다시 만듭니다.

제목 글꼴(고운바탕)은 index.html과 credits.html에 실제로 쓰인 글자만 담습니다.
가게 이름이나 제목 문구를 바꾸면 이 스크립트를 다시 돌려야 새 글자가 같은 글꼴로 나옵니다.
본문 글꼴(Gothic A1)은 자주 쓰는 한글 2,350자를 모두 담아서 메뉴 이름을 바꿔도 그대로 나옵니다.

준비: pip install fonttools brotli
실행: python3 tools/subset-fonts.py   (저장소 맨 위 폴더에서)
원본 TTF는 Google Fonts에서 내려받습니다 (SIL Open Font License 1.1).
"""
import html, os, re, subprocess, tempfile, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts")
SOURCES = {
    "gowunbatang-400": ("https://fonts.gstatic.com/s/gowunbatang/v12/ijwSs5nhRMIjYsdSgcMa3wRhXA.ttf", "page"),
    "gothica1-400": ("https://fonts.gstatic.com/s/gothica1/v18/CSR94z5ZnPydRjlCCwl6bA.ttf", "ks"),
    "gothica1-500": ("https://fonts.gstatic.com/s/gothica1/v18/CSR44z5ZnPydRjlCCwlCmOQKSA.ttf", "ks"),
}


def page_chars():
    text = ""
    for name in ("index.html", "credits.html"):
        path = os.path.join(ROOT, name)
        if os.path.exists(path):
            text += open(path, encoding="utf-8").read()
    text = html.unescape(re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", text, flags=re.S))
    return {ch for ch in text if ord(ch) > 32}


def ks_hangul():
    chars = set()
    for hi in range(0xB0, 0xC9):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("euc-kr"))
            except UnicodeDecodeError:
                pass
    return chars


def main():
    base = page_chars() | {chr(c) for c in range(32, 127)} | set("–—·…‘’“”©×°₩")
    sets = {"page": base, "ks": base | ks_hangul()}
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, (url, which) in SOURCES.items():
            src = os.path.join(tmp, name + ".ttf")
            urllib.request.urlretrieve(url, src)
            chars = os.path.join(tmp, name + ".txt")
            open(chars, "w", encoding="utf-8").write("".join(sorted(sets[which])))
            out = os.path.join(OUT, name + ".woff2")
            subprocess.run(
                ["pyftsubset", src, "--text-file=" + chars, "--flavor=woff2", "--output-file=" + out,
                 "--layout-features=*", "--no-hinting", "--desubroutinize"],
                check=True,
            )
            print(name, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
