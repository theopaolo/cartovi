import collections, csv, io, json, re, struct, sys, urllib.request, zipfile, gzip, xml.etree.ElementTree as ET
def get(url, timeout=900):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "carteplan-probe"}), timeout=timeout) as r:
        b = r.read()
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
def xlsx(data, nrows=8):
    z = zipfile.ZipFile(io.BytesIO(data))
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    names = [s.get("name") for s in wb.find("m:sheets", NS)]
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    targets = [r.get("Target") for r in rels if "worksheet" in r.get("Type")]
    for name, t in zip(names, targets):
        root = ET.fromstring(z.read("xl/" + t.lstrip("/").replace("xl/", "")))
        rows = root.findall(".//m:sheetData/m:row", NS)
        print(f"--- feuille {name!r} : {len(rows)} lignes")
        for row in rows[:nrows]:
            vals = []
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS); is_ = c.find("m:is", NS)
                txt = (ss[int(v.text)] if c.get("t") == "s" else v.text) if v is not None else ("".join(x.text or "" for x in is_.iter("{%s}t" % NS["m"])) if is_ is not None else "")
                vals.append(f"{c.get('r')}={txt}")
            print("   ", " | ".join(vals)[:900])
def dbf(b, n=6):
    nrec, hlen, rlen = struct.unpack("<IHH", b[4:12])
    fields = []
    for i in range(32, hlen - 1, 32):
        f = b[i:i + 32]
        fields.append((f[:11].split(b"\0")[0].decode(), chr(f[11]), f[16]))
    print("DBF", nrec, "enregistrements ; champs", fields)
    recs = []
    for k in range(nrec):
        o = hlen + k * rlen + 1; vals = []
        for name, t, ln in fields:
            vals.append(b[o:o + ln].decode("latin-1").strip()); o += ln
        recs.append(vals)
    for r in recs[:n]: print("   ", r)
    for j, (name, t, ln) in enumerate(fields):
        cnt = collections.Counter(r[j] for r in recs)
        if len(cnt) <= 40: print("  ", name, sorted(cnt.items()))
what = sys.argv[1]
if what == "lcz":
    d = json.loads(get("https://www.data.gouv.fr/api/1/datasets/6641c562e5acdb35c0e6051d/"))
    zips = [r for r in d["resources"] if r["format"] == "zip"]
    print(len(zips), "zips, total", sum(r.get("filesize") or 0 for r in zips) // 2**20, "Mo")
    for r in d["resources"]:
        if r["format"] != "zip": print("-", r["title"], r["format"], r.get("filesize"), r["url"])
    print("titres :", sorted(r["title"] for r in zips))
    url = next(r["url"] for r in zips if r["title"] == "lcz-spot-2022-albi.zip")
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    for i in z.infolist(): print("  ", i.filename, i.file_size)
    for n in z.namelist():
        if n.lower().endswith(".dbf"): dbf(z.read(n))
        if n.lower().endswith(".prj"): print("PRJ", z.read(n)[:300])
        if n.lower().endswith(".tif"):
            t = z.read(n); bo = "<" if t[:2] == b"II" else ">"
            off = struct.unpack(bo + "I", t[4:8])[0]; nt = struct.unpack(bo + "H", t[off:off + 2])[0]
            for k in range(nt):
                tag, typ, cnt, val = struct.unpack(bo + "HHII", t[off + 2 + 12 * k: off + 14 + 12 * k])
                print("  TIFF tag", tag, typ, cnt, val)
        if n.lower().endswith((".csv", ".txt", ".xml")) and z.getinfo(n).file_size < 200000: print(n, z.read(n)[:1500])
elif what == "xlsx":
    xlsx(get(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 8)
elif what == "lines":
    t = get(sys.argv[2]).decode("latin-1")
    lines = t.splitlines(); print(len(lines), "lignes")
    print("\n".join(lines[:4])); print("..."); print("\n".join(lines[len(lines)//2: len(lines)//2 + 3]))
    print(collections.Counter(l.split(";")[0] for l in lines).most_common(5))
