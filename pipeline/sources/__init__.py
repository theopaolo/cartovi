"""Registre des sources. Chaque entrée expose SOURCE, INDICATORS et fetch(ctx).

Ordre : sources légères d'abord, puis les plus longues (Géorisques ≈ 15 min,
Open-Meteo espacé pour respecter son quota par minute). TRACC lit des fichiers
versionnés dans le dépôt : aucun appel réseau hors la liste des communes.
"""

from . import catnat, consoenaf, dvf, nuclear, onde, population, tracc, vigieau
from .georisques import Seveso, SolsPollues
from .openmeteo import Recent

SOURCES = [population, dvf, consoenaf, nuclear, catnat, vigieau, onde, tracc, SolsPollues, Recent, Seveso]
