import urllib.parse
# Sonde : jeux Explore2 TRACC du RARE sur data.gouv (ressources, en-têtes des CSV communaux, documentation)
import io, json, sys, urllib.request
def get(url, rng=None):
    h = {"User-Agent": "carteplan-probe"}
    if rng: h["Range"] = f"bytes=0-{rng}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=240) as r:
        return r.read()
def pdf(url, pages=6):
    import pypdf
    r = pypdf.PdfReader(io.BytesIO(get(url)))
    return "\n".join((p.extract_text() or "") for p in r.pages[:pages])
for ds in ("69848339e734f1ba1e7f3217", "6984b51bbcec9075a423a373"):
    d = json.loads(get(f"https://www.data.gouv.fr/api/1/datasets/{ds}/"))
    print("#####", d["title"], "| maj", d.get("last_modified"), "| licence", d.get("license"))
    print(d.get("description", "")[:2500])
    org = d.get("organization") or {}
    for r in d["resources"]:
        print(f"- {r['title']} | {r.get('filesize')} | {r.get('last_modified','')[:10]} | {r['url']}")
    if ds == "69848339e734f1ba1e7f3217":
        for r in d["resources"]:
            if "COMMUNE" in r["title"] and r["title"].endswith(".csv"):
                print("=== en-tête", r["title"])
                print(get(r["url"], 2500).decode("utf-8", "replace"))
                break
        for r in d["resources"]:
            if r["title"].startswith(("20250218_RARE_documentation", "Fiche_STATISTIQUES")):
                print("=== PDF", r["title"])
                try: print(pdf(r["url"], 12)[:12000])
                except Exception as e: print("ERR", e)
print("##### autres jeux de l'organisation", org.get("name"))
o = json.loads(get(f"https://www.data.gouv.fr/api/1/organizations/{org['id']}/datasets/?page_size=50"))
for d in o["data"]:
    print("-", d["title"], "|", d["id"], "|", len(d["resources"]), "ressources")
for q in ("climadiag", "indicateurs climatiques commune", "TRACC commune", "DRIAS"):
    s = json.loads(get("https://www.data.gouv.fr/api/1/datasets/?page_size=15&q=" + urllib.parse.quote(q)))
    print("##### recherche", q)
    for d in s["data"]:
        print("-", d["title"], "|", (d.get("organization") or {}).get("name"), "|", d["id"])
