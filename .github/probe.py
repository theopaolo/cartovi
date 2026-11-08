import csv, io, json, re, sys, urllib.request, zipfile, gzip, subprocess, collections
def get(url, timeout=600):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "carteplan-probe", "Accept-Encoding": "gzip"}), timeout=timeout) as r:
        b = r.read()
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
what = sys.argv[1]
if what == "cj":
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--break-system-packages", "xlrd"], check=False)
    import xlrd
    wb = xlrd.open_workbook(file_contents=get("https://www.insee.fr/fr/statistiques/fichier/2028129/cj_septembre_2022.xls"))
    for sh in wb.sheets():
        for i in range(sh.nrows):
            row = [str(c.value) for c in sh.row(i)]
            if any(re.search(r"(coop|SCOP|intérêt collectif|mutu|fondation)", x, re.I) for x in row[1:2]): print(sh.name, "|", row[0], "|", row[1][:110])
elif what == "melodi":
    for ds, fid in (("DS_RP_NAVETTES_PRINC", "DS_RP_NAVETTES_PRINC_2023_CSV_FR"), ("DS_BPE_EDUCATION", "DS_BPE_EDUCATION_2025_CSV_FR")):
        z = zipfile.ZipFile(io.BytesIO(get(f"https://api.insee.fr/melodi/file/{ds}/{fid}")))
        print("#####", ds, z.namelist())
        for n in z.namelist():
            t = z.read(n).decode("utf-8-sig", "replace")
            lines = t.splitlines(); print(n, len(lines), "lignes"); print("\n".join(lines[:4])[:1500])
            if "metadata" in n.lower() or n.lower().endswith("_metadata.csv") or "meta" in n.lower():
                for ln in lines:
                    if re.search(r"(TRANS|C201|C301|C302|C1|C2|C3|F303|F305|F307|F312|F313|F314|F315|CARS)", ln): print("  META", ln[:200])
elif what == "fest":
    d = json.loads(get("https://www.data.gouv.fr/api/1/datasets/5b51825fa3a72936dfe1c340/"))
    print("MAJ", d.get("last_modified"), d.get("license"))
    for r in d["resources"]: print("-", r["title"], r["format"], r.get("filesize"), r.get("last_modified", "")[:10], r["url"])
    url = next(r["url"] for r in d["resources"] if r["format"] == "csv")
    t = get(url).decode("utf-8-sig", "replace")
    rd = csv.reader(io.StringIO(t), delimiter=";" if t.count(";") > t.count(",") else ",")
    head = next(rd); rows = list(rd); print(len(rows), "festivals ;", head)
    for r in rows[:2]: print(dict(zip(head, r)))
elif what == "tl":
    t = get("https://static.data.gouv.fr/resources/recensement-des-tiers-lieux-en-france-2026/20260902-111854/bdftl-2026-01-fiche-identite.csv").decode("utf-8-sig", "replace")
    rd = csv.reader(io.StringIO(t), delimiter=";"); head = next(rd); rows = list(rd)
    print(len(rows), "lignes ;", head[:40])
    for k in head:
        if re.search(r"(statut|activit|ferm|projet)", k, re.I): print(k, collections.Counter(r[head.index(k)] for r in rows if len(r) == len(head)).most_common(6))
    print("lignes complètes :", sum(1 for r in rows if len(r) == len(head)), "| avec coordonnées :", sum(1 for r in rows if len(r) == len(head) and r[head.index('LATITUDE')]))
