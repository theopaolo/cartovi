# Sonde : RNA (associations), tiers-lieux, catalogue Melodi (INSEE), catégories juridiques
import csv, io, json, re, sys, urllib.request, zipfile
def get(url, timeout=600):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "carteplan-probe"}), timeout=timeout) as r:
        return r.read()
what = sys.argv[1]
if what == "melodi":
    d = json.loads(get("https://api.insee.fr/melodi/catalog/all"))
    items = d if isinstance(d, list) else d.get("items") or d.get("datasets") or d
    print(type(d).__name__, len(items) if hasattr(items, "__len__") else "?")
    s = json.dumps(items, ensure_ascii=False)
    print(s[:800])
    for it in (items if isinstance(items, list) else []):
        t = json.dumps(it, ensure_ascii=False)
        if re.search(r"(voiture|transport|navette|déplacement|DS_RP_LOGEMENT|DS_RP_NAVETTES|DS_RP_EMPLOI|équipement|BPE|DS_BPE)", t, re.I):
            ident = it.get("identifier") or it.get("id")
            title = it.get("title")
            if isinstance(title, list): title = next((x.get("content") for x in title if x.get("lang") == "fr"), title)
            print("-", ident, "|", str(title)[:140])
elif what == "rna":
    z = zipfile.ZipFile(io.BytesIO(get("https://media.interieur.gouv.fr/rna/rna_waldec_20261001.zip")))
    names = z.namelist(); print(len(names), names[:5])
    t = z.read(names[0]).decode("latin-1", "replace")
    print(t[:1500])
    rows = list(csv.DictReader(io.StringIO(t), delimiter=";"))
    print(len(rows), "lignes ;", {k: rows[0][k] for k in list(rows[0])[:40]})
    for k in ("position", "nature", "groupement"):
        if k in rows[0]:
            from collections import Counter; print(k, Counter(r[k] for r in rows).most_common(8))
elif what == "tl":
    d = json.loads(get("https://www.data.gouv.fr/api/1/datasets/6a97e79385c92876997291c8/"))
    for r in d["resources"]: print("-", r["title"], r["format"], r.get("filesize"), r["url"])
    print("LICENCE", d.get("license"), "| desc :", d.get("description", "")[:600])
    url = next(r["url"] for r in d["resources"] if r["format"] == "csv")
    t = get(url).decode("utf-8-sig", "replace")
    head = t.splitlines()[0]; print("colonnes :", head[:3000])
    print(t.splitlines()[1][:1500]); print(len(t.splitlines()), "lignes")
elif what == "cj":
    t = get("https://www.insee.fr/fr/information/2028129").decode("utf-8", "replace")
    print(sorted(set(re.findall(r'href="([^"]+\.(?:xls|xlsx|csv|zip|ods))"', t)))[:20])
