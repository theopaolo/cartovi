// classes.js — libellés des classes. Les descriptions sont relatives : elles décrivent
// une position dans le classement, pas un niveau absolu.
export const CLASSES = [
  { name: 'Très favorable', desc: '20 % des départements les mieux classés selon vos pondérations' },
  { name: 'Favorable', desc: 'Deuxième cinquième : au-dessus de la médiane, bon compromis' },
  { name: 'Modéré', desc: 'Cinquième central : ni atouts ni contraintes marqués' },
  { name: 'Défavorable', desc: 'Quatrième cinquième : sous la médiane, contraintes cumulées' },
  { name: 'Très défavorable', desc: '20 % des départements les moins bien classés selon vos pondérations' },
];

// Mode « un seul indicateur » : classes par quintiles de valeurs brutes (1 = valeurs les plus basses).
export const VALUE_CLASSES = ['Très bas', 'Bas', 'Moyen', 'Haut', 'Très haut'];
