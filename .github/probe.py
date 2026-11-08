# Sonde : fichiers communaux Explore2 TRACC (RARE) — structure, modalités, couverture, mention « test »
import collections, csv, io, json, re, urllib.request
DS = "69848339e734f1ba1e7f3217"
def open_url(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "carteplan-probe"}), timeout=600)
d = json.load(open_url(f"https://www.data.gouv.fr/api/1/datasets/{DS}/"))
print("TITRE", d["title"]); print("PAGE", d.get("page")); print("SLUG", d.get("slug")); print("LICENCE", d.get("license"))
print("MAJ", d.get("last_modified"), "| créé", d.get("created_at"))
desc = d.get("description", "")
for m in re.finditer(r"[^\n]{0,200}test[^\n]{0,200}", desc, re.I):
    print("DESC-TEST :", m.group(0))
print("TAGS", d.get("tags")); print("BADGES", d.get("badges")); print("EXTRAS", json.dumps(d.get("extras"), ensure_ascii=False)[:600])
com = [r for r in d["resources"] if "COMMUNE" in r["title"]]
for r in com:
    print(f"- {r['title']} | {r.get('filesize')} | {r.get('last_modified','')[:10]} | {r['url']}")
for r in com:
    if not r["title"].startswith("STATISTIQUES_MULTIMODELES"):
        continue
    print("=====", r["title"])
    f = io.TextIOWrapper(open_url(r["url"]), encoding="utf-8-sig", newline="")
    rd = csv.DictReader(f)
    print("colonnes", rd.fieldnames)
    distinct = {k: collections.Counter() for k in ("type_territoire", "rechauffement_france", "code_indicateur", "nom_indicateur", "type_indicateur", "periode_calcul_indicateur", "donnees_issues_territoire", "statistique")}
    codes, n, empty, ex = set(), 0, 0, collections.defaultdict(list)
    per = collections.Counter()
    for row in rd:
        n += 1
        for k in distinct:
            distinct[k][row.get(k)] += 1
        c = row.get("code_territoire"); codes.add(c)
        if row.get("resultat") in ("", "NA", None):
            empty += 1
        if c in ("69123", "31555", "29155", "84007", "13055", "75056", "38185"):
            ex[c].append((row["rechauffement_france"], row["statistique"], row["resultat"], row["donnees_issues_territoire"]))
        per[(c, row["rechauffement_france"], row["statistique"])] += 1
    print("lignes", n, "| communes", len(codes), "| résultats vides", empty, "| doublons (commune, niveau, stat)", sum(1 for v in per.values() if v > 1))
    for k, v in distinct.items():
        print(" ", k, v.most_common(12))
    for c, rows in ex.items():
        print("  ex", c, rows[:24])
    print("  codes non numériques", [c for c in codes if not re.fullmatch(r"\d[\dAB]\d{3}", c or "")][:10])
