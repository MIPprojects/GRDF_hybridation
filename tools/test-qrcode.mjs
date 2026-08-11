/**
 * Vérification de l'encodeur QR.
 *
 *  1. Vecteur de référence de l'annexe I d'ISO/IEC 18004 : « 01234567 » en
 *     version 1, niveau M — codets de données et de correction attendus.
 *  2. Aller-retour complet : on relit la matrice produite dans l'ordre de
 *     parcours, on démasque, on désentrelace et on redécode le texte.
 *  3. Invariants de structure : motifs de position, synchronisation, module noir.
 *
 * usage : node tools/test-qrcode.mjs
 */
import { encoder, correction } from '../js/qrcode.js';

let echecs = 0;
const verifier = (nom, condition, detail = '') => {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${nom}`);
  } else {
    echecs++;
    console.log(`  \x1b[31m✗\x1b[0m ${nom}${detail ? `\n      ${detail}` : ''}`);
  }
};

const hex = (a) => [...a].map((v) => v.toString(16).padStart(2, '0')).join(' ');

/* --- 1. Vecteur de la norme ------------------------------------------------ */

console.log('\nISO/IEC 18004 annexe I — « 01234567 » version 1-M');

const DONNEES_ATTENDUES = [
  0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11,
  0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
];
const CORRECTION_ATTENDUE = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];

const ec = correction(Uint8Array.from(DONNEES_ATTENDUES), 10);
verifier(
  'codets de correction Reed-Solomon',
  hex(ec) === hex(Uint8Array.from(CORRECTION_ATTENDUE)),
  `attendu ${hex(Uint8Array.from(CORRECTION_ATTENDUE))}\n      obtenu ${hex(ec)}`
);

/* --- 2. Aller-retour -------------------------------------------------------- */

// Réimplémentation du parcours et des masques, côté lecture.
const MASQUES = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
const ALIGNEMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const CODETS_TOTAUX = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const BLOCS = {
  1: { L: [7, 1, 0], M: [10, 1, 0] }, 2: { L: [10, 1, 0], M: [16, 1, 0] },
  3: { L: [15, 1, 0], M: [26, 1, 0] }, 4: { L: [20, 1, 0], M: [18, 2, 0] },
  5: { L: [26, 1, 0], M: [24, 2, 0] }, 6: { L: [18, 2, 0], M: [16, 4, 0] },
  7: { L: [20, 2, 0], M: [18, 4, 0] }, 8: { L: [24, 2, 0], M: [22, 2, 2] },
  9: { L: [30, 2, 0], M: [22, 3, 2] }, 10: { L: [18, 2, 2], M: [26, 4, 1] },
};

/** Reconstruit la carte des modules réservés (identique à l'encodeur). */
function reserve(taille, version) {
  const r = Array.from({ length: taille }, () => new Uint8Array(taille));
  const marquer = (y, x) => { if (y >= 0 && x >= 0 && y < taille && x < taille) r[y][x] = 1; };

  for (const [dy, dx] of [[0, 0], [0, taille - 7], [taille - 7, 0]]) {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) marquer(dy + y, dx + x);
  }
  for (let i = 8; i < taille - 8; i++) { marquer(6, i); marquer(i, 6); }

  const centres = ALIGNEMENT[version];
  for (const y of centres) for (const x of centres) {
    if ((y === 6 && x === 6) || (y === 6 && x === taille - 7) || (y === taille - 7 && x === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) marquer(y + dy, x + dx);
  }
  marquer(taille - 8, 8);
  for (let i = 0; i <= 8; i++) { if (i !== 6) { marquer(8, i); marquer(i, 8); } }
  for (let i = 0; i < 8; i++) { marquer(8, taille - 1 - i); marquer(taille - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      marquer(i, taille - 11 + j); marquer(taille - 11 + j, i);
    }
  }
  return r;
}

function* chemin(taille, res) {
  let montant = true;
  for (let colonne = taille - 1; colonne > 0; colonne -= 2) {
    if (colonne === 6) colonne = 5;
    for (let i = 0; i < taille; i++) {
      const y = montant ? taille - 1 - i : i;
      for (const x of [colonne, colonne - 1]) if (!res[y][x]) yield [y, x];
    }
    montant = !montant;
  }
}

/** Relit une matrice produite par l'encodeur et retourne le texte décodé. */
function decoder({ modules, taille, version, masque }, niveau) {
  const res = reserve(taille, version);
  const bits = [];
  for (const [y, x] of chemin(taille, res)) {
    bits.push((modules[y][x] !== MASQUES[masque](y, x)) ? 1 : 0);
  }

  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    octets.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }

  // désentrelacement
  const [ecParBloc, g1, g2] = BLOCS[version][niveau];
  const nbBlocs = g1 + g2;
  const totalDonnees = CODETS_TOTAUX[version - 1] - ecParBloc * nbBlocs;
  const tailleCourte = Math.floor(totalDonnees / nbBlocs);
  const tailles = Array.from({ length: nbBlocs }, (_, i) => tailleCourte + (i >= g1 ? 1 : 0));

  const blocs = tailles.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...tailles); i++) {
    for (let b = 0; b < nbBlocs; b++) if (i < tailles[b]) blocs[b].push(octets[k++]);
  }
  const donnees = blocs.flat();

  // lecture du flux : mode, compteur, charge utile
  const flux = donnees.flatMap((o) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (o >> s) & 1));
  let p = 0;
  const lire = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | flux[p++]; return v; };

  const mode = lire(4);
  if (mode === 4) {
    const n = lire(version <= 9 ? 8 : 16);
    const brut = Uint8Array.from({ length: n }, () => lire(8));
    return new TextDecoder().decode(brut);
  }
  if (mode === 1) {
    const n = lire(version <= 9 ? 10 : 12);
    let out = '';
    for (let reste = n; reste > 0;) {
      const groupe = Math.min(3, reste);
      out += String(lire(groupe * 3 + 1)).padStart(groupe, '0');
      reste -= groupe;
    }
    return out;
  }
  throw new Error(`mode inattendu : ${mode}`);
}

console.log('\nAller-retour encodage → matrice → décodage');

const CAS = [
  ['01234567', 'M'],
  ['http://192.168.1.42:8080/play.html?code=482913', 'M'],
  ['http://localhost:8080/play.html?code=100000', 'L'],
  ['https://frise-grdf.example.com/play.html?code=999999&salle=CAPEB', 'L'],
  ['Chaudière THPE + système solaire combiné — accents, €, ₂', 'M'],
  ['9'.repeat(120), 'M'],
];

for (const [texte, niveau] of CAS) {
  let ok = false, detail = '';
  try {
    const qr = encoder(texte, { niveau });
    const relu = decoder(qr, niveau);
    ok = relu === texte;
    detail = ok ? '' : `attendu « ${texte} »\n      obtenu  « ${relu} »`;
    const apercu = texte.length > 34 ? `${texte.slice(0, 34)}…` : texte;
    verifier(`${niveau} v${qr.version} masque ${qr.masque} — « ${apercu} »`, ok, detail);
  } catch (err) {
    verifier(`« ${texte.slice(0, 34)} »`, false, String(err.message));
  }
}

/* --- 3. Invariants de structure -------------------------------------------- */

console.log('\nInvariants de structure');

const qr = encoder('http://192.168.1.42:8080/play.html?code=482913', { niveau: 'M' });
const m = qr.modules;
const n = qr.taille;

const motifPosition = (dy, dx) => {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const attendu = y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
      if (m[dy + y][dx + x] !== attendu) return false;
    }
  }
  return true;
};

verifier('motif de position haut-gauche', motifPosition(0, 0));
verifier('motif de position haut-droit', motifPosition(0, n - 7));
verifier('motif de position bas-gauche', motifPosition(n - 7, 0));

let synchroOk = true;
for (let i = 8; i < n - 8; i++) {
  if (m[6][i] !== (i % 2 === 0) || m[i][6] !== (i % 2 === 0)) synchroOk = false;
}
verifier('motifs de synchronisation', synchroOk);
verifier('module toujours noir', m[n - 8][8] === true);
verifier('taille cohérente avec la version', n === qr.version * 4 + 17);

let separateurOk = true;
for (let i = 0; i < 8; i++) {
  if (m[7][i] || m[i][7]) separateurOk = false;                     // haut-gauche
  if (m[7][n - 1 - i] || m[i][n - 8]) separateurOk = false;         // haut-droit
  if (m[n - 8][i] || m[n - 1 - i][7]) separateurOk = false;         // bas-gauche
}
verifier('séparateurs blancs autour des motifs de position', separateurOk);

console.log(
  echecs === 0
    ? '\n\x1b[32mTous les contrôles passent.\x1b[0m\n'
    : `\n\x1b[31m${echecs} contrôle(s) en échec.\x1b[0m\n`
);
process.exit(echecs === 0 ? 0 : 1);
