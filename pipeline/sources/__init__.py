"""Registre des sources. Chaque entrée expose SOURCE, INDICATORS et fetch(ctx).

Ordre : sources légères d'abord, puis les plus longues (Géorisques ≈ 15 min,
Open-Meteo espacé pour respecter son quota par minute ; le climat futur,
rafraîchi une fois par an, passe avant le climat récent pour ne pas être
privé de quota horaire chaque fois que les deux échoient ensemble).
"""

from . import catnat, consoenaf, dvf, nuclear, onde, population, vigieau
from .georisques import Seveso, SolsPollues
from .openmeteo import Future, Recent

SOURCES = [population, dvf, consoenaf, nuclear, catnat, vigieau, onde, SolsPollues, Future, Recent, Seveso]
