"""Lecture minimale d'un classeur .xlsx (Office Open XML) avec la bibliothèque standard.

Un .xlsx est une archive zip de fichiers XML : la liste des feuilles (xl/workbook.xml), leurs
emplacements (xl/_rels/workbook.xml.rels), les chaînes partagées (xl/sharedStrings.xml) et une
feuille par fichier. On ne lit que les valeurs (ni styles ni formules) : c'est ce que publient la
DREES et l'INSEE dans leurs tableaux.
"""

import io
import re
import zipfile
import xml.etree.ElementTree as ET

_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _col(ref):
    """« AB12 » -> 27 (colonne, à partir de 0)."""
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


class Workbook:
    def __init__(self, data):
        self.zip = zipfile.ZipFile(io.BytesIO(data))
        names = self.zip.namelist()
        self.strings = []
        if "xl/sharedStrings.xml" in names:
            for si in ET.fromstring(self.zip.read("xl/sharedStrings.xml")).iter(f"{_M}si"):
                self.strings.append("".join(t.text or "" for t in si.iter(f"{_M}t")))
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(self.zip.read("xl/_rels/workbook.xml.rels"))}
        wb = ET.fromstring(self.zip.read("xl/workbook.xml"))
        self.sheets = {}
        for s in wb.iter(f"{_M}sheet"):
            target = rels[s.get(_RID)].lstrip("/")
            self.sheets[s.get("name")] = target if target.startswith("xl/") else "xl/" + target

    def rows(self, sheet):
        """Lignes de la feuille, en listes de valeurs (chaînes, nombres ou None), cellules vides comprises."""
        with self.zip.open(self.sheets[sheet]) as f:
            for _, el in ET.iterparse(f):
                if el.tag != f"{_M}row":
                    continue
                row = []
                for c in el.iter(f"{_M}c"):
                    j = _col(c.get("r"))
                    row.extend([None] * (j - len(row)))
                    row.append(self._value(c))
                el.clear()
                yield row

    def _value(self, c):
        t = c.get("t")
        if t == "inlineStr":
            return "".join(x.text or "" for x in c.iter(f"{_M}t"))
        v = c.find(f"{_M}v")
        if v is None or v.text is None:
            return None
        if t == "s":
            return self.strings[int(v.text)]
        if t in ("str", "b", "e"):
            return v.text
        x = float(v.text)
        return int(x) if x.is_integer() else x


def table(rows, first_header):
    """Saute les lignes de titre jusqu'à l'en-tête (première cellule = first_header) ; renvoie (en-tête, lignes)."""
    rows = iter(rows)
    for r in rows:
        if r and isinstance(r[0], str) and r[0].strip() == first_header:
            return [str(x or "").strip() for x in r], rows
    raise ValueError(f"en-tête « {first_header} » introuvable")
