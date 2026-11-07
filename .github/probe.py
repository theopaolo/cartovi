import zipfile, csv, io, collections
z = zipfile.ZipFile("/tmp/r"); names = z.namelist(); print(names)
def rows(pat):
    n = [x for x in names if pat in x][0]
    t = z.read(n).decode("utf-8-sig", "replace")
    return list(csv.DictReader(io.StringIO(t), delimiter=";"))
c = rows("catnat_gaspar"); k = [f for f in c[0] if "lib_risque" in f][0]
print("CATNAT", list(c[0].keys()))
print(collections.Counter(r[k] for r in c).most_common(40))
d = rows("ddrm_risq"); print("DDRM", list(d[0].keys())); print(d[0]); print(d[1])
kk = [f for f in d[0] if "risq" in f.lower()]
for f in kk: print(f, collections.Counter(r[f] for r in d).most_common(45))
p = rows("pprn_gaspar"); print("PPRN", list(p[0].keys())); print(p[0])
kl = [f for f in p[0] if "risque" in f.lower()]
for f in kl: print(f, collections.Counter(x.strip() for r in p for x in (r[f] or "").split(",")).most_common(30))
etat = [f for f in p[0] if "etat" in f.lower() or "dat_" in f.lower() or "date" in f.lower()]
print("PPRN dates/états", etat, [ (f, collections.Counter(bool(r[f]) for r in p)) for f in etat ])
t = rows("tim_gaspar"); print("TIM", list(t[0].keys())); print(t[0])
