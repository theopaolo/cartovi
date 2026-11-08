import urllib.parse
import csv, io, json, re, sys, urllib.request, zipfile, gzip
def get(url, timeout=600):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "carteplan-probe", "Accept-Encoding": "gzip"}), timeout=timeout) as r:
        b = r.read()
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
what = sys.argv[1]
if what == "melodi":
    for ds in ("DS_RP_LOGEMENT_PRINC", "DS_RP_NAVETTES_PRINC", "DS_BPE", "DS_BPE_SPORT_CULTURE", "DS_BPE_EDUCATION"):
        print("#####", ds)
        try:
            m = json.loads(get(f"https://api.insee.fr/melodi/catalog/{ds}"))
            dist = m.get("product") or m.get("distribution") or m.get("distributions")
            print("clés :", list(m)[:30]); print("distribution :", json.dumps(dist, ensure_ascii=False)[:900])
            print("période :", json.dumps(m.get("temporal") or m.get("temporalCoverage"), ensure_ascii=False)[:200])
        except Exception as e: print("ERR catalog", e)
        try:
            d = json.loads(get(f"https://api.insee.fr/melodi/data/{ds}?GEO=COM-26362&maxResult=400"))
            obs = d.get("observations") or []
            print("observations", len(obs), "| total", d.get("paging"))
            dims = {}
            for o in obs:
                for k, v in (o.get("dimensions") or {}).items(): dims.setdefault(k, set()).add(v)
            print("dimensions :", {k: sorted(v)[:40] for k, v in dims.items()})
            print("ex :", json.dumps(obs[:2], ensure_ascii=False)[:900])
        except Exception as e: print("ERR data", e)
elif what == "tl":
    t = get("https://static.data.gouv.fr/resources/recensement-des-tiers-lieux-en-france-2026/20260902-111854/bdftl-2026-01-fiche-identite.csv").decode("utf-8-sig", "replace")
    rd = csv.reader(io.StringIO(t), delimiter=";"); head = next(rd); rows = list(rd)
    print(len(rows), "lignes ;", len(head), "colonnes")
    keep = [i for i, h in enumerate(head) if re.search(r"(commune|insee|lat|lon|adresse|code|postal|statut|ville|nom|x_|y_|geo)", h, re.I)]
    print([head[i] for i in keep][:60])
    for r in rows[:3]: print({head[i]: r[i] for i in keep if i < len(r)})
elif what == "cj":
    import subprocess; subprocess.run([sys.executable, "-m", "pip", "-q", "install", "xlrd"], check=False)
    import xlrd
    wb = xlrd.open_workbook(file_contents=get("https://www.insee.fr/fr/statistiques/fichier/2028129/cj_septembre_2022.xls"))
    for sh in wb.sheets():
        for i in range(sh.nrows):
            row = [str(c.value) for c in sh.row(i)]
            if any(re.search(r"(coop|mutu|fondation|SCOP|intérêt collectif)", x, re.I) for x in row): print(sh.name, row[:3])
elif what == "fest":
    for q in ("festivals", "panorama des festivals"):
        d = json.loads(get("https://www.data.gouv.fr/api/1/datasets/?page_size=8&q=" + urllib.parse.quote(q)))
        for x in d["data"]: print("-", x["title"], "|", (x.get("organization") or {}).get("name"), "|", x["id"], [ (r["format"], r.get("filesize")) for r in x["resources"][:3]])
