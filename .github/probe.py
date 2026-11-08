# Sonde : arborescence du serveur public Météo-France (DRIAS) — sans authentification ?
import re, sys, time, urllib.request, html
ROOT = "https://climatedata.cnrm-game-meteo.fr/public/dcsc/projects/DRIAS/"
ROW = re.compile(r'href="([^"?/][^"]*)".*?(\d{4}-\d\d-\d\d \d\d:\d\d|\d\d-\w{3}-\d{4} \d\d:\d\d)?\s*(?:</td><td[^>]*>)?\s*([\d.]+[KMG]?|-)?\s*<', re.S)
seen, budget = set(), [450]
def ls(url):
    budget[0] -= 1
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "carteplan-probe"}), timeout=60) as r:
        t = r.read().decode("utf-8", "replace")
    dirs, files = [], []
    for line in t.splitlines():
        m = re.search(r'href="([^"?/][^"]*)"', line)
        if not m or m.group(1).startswith(("http", "#", "..")):
            continue
        name = html.unescape(m.group(1))
        size = re.findall(r'>\s*([\d.]+[KMG]?)\s*<', line)
        date = re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d|\d\d-\w{3}-\d{4} \d\d:\d\d)', line)
        (dirs if name.endswith("/") else files).append((name, size[-1] if size else "?", date[0] if date else ""))
    return dirs, files
def walk(url, depth):
    if url in seen or budget[0] <= 0: return
    seen.add(url)
    try: dirs, files = ls(url)
    except Exception as e: print("ERR", url[len(ROOT):], e); return
    rel = url[len(ROOT):] or "/"
    ex = ", ".join(f"{n} [{s} {d}]" for n, s, d in files[:4])
    print(f"{rel}  dirs={len(dirs)} files={len(files)}  {ex}")
    if depth == 0: return
    for n, _, _ in dirs:
        # on n'ouvre pas les centaines de sous-dossiers par modèle : 6 premiers seulement
        walk(url + n, depth - 1) if len(dirs) < 25 or "TRACC" in n.upper() else None
    if len(dirs) >= 25:
        print(f"   … {len(dirs)} sous-dossiers : {', '.join(n for n,_,_ in dirs[:25])}")
walk(ROOT, int(sys.argv[1]) if len(sys.argv) > 1 else 6)
print("requêtes restantes", budget[0])
