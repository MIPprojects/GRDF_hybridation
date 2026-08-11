/**
 * Encodeur QR Code minimal (ISO/IEC 18004), sans dépendance ni réseau.
 * Modes numérique et octet, versions 1 à 10, niveaux de correction L/M/Q/H.
 * Suffisant pour une URL de salon sur réseau local.
 *
 * Vérifié par tools/test-qrcode.mjs :
 *  - vecteur de référence de l'annexe I de la norme (« 01234567 », 1-M) ;
 *  - aller-retour encodage -> placement -> relecture -> décodage.
 */

/* ------------------------------------------------------- tables de la norme --- */

// Nombre total de codets par version (1 à 10)
const CODETS_TOTAUX = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

// Par version puis par niveau [L, M, Q, H] : [codets de correction par bloc, nb blocs groupe 1, nb blocs groupe 2]
const BLOCS = {
  1:  { L: [7, 1, 0],   M: [10, 1, 0],  Q: [13, 1, 0],  H: [17, 1, 0] },
  2:  { L: [10, 1, 0],  M: [16, 1, 0],  Q: [22, 1, 0],  H: [28, 1, 0] },
  3:  { L: [15, 1, 0],  M: [26, 1, 0],  Q: [18, 2, 0],  H: [22, 2, 0] },
  4:  { L: [20, 1, 0],  M: [18, 2, 0],  Q: [26, 2, 0],  H: [16, 4, 0] },
  5:  { L: [26, 1, 0],  M: [24, 2, 0],  Q: [18, 2, 2],  H: [22, 2, 2] },
  6:  { L: [18, 2, 0],  M: [16, 4, 0],  Q: [24, 4, 0],  H: [28, 4, 0] },
  7:  { L: [20, 2, 0],  M: [18, 4, 0],  Q: [18, 2, 4],  H: [26, 4, 1] },
  8:  { L: [24, 2, 0],  M: [22, 2, 2],  Q: [22, 4, 2],  H: [26, 4, 2] },
  9:  { L: [30, 2, 0],  M: [22, 3, 2],  Q: [20, 4, 4],  H: [24, 4, 4] },
  10: { L: [18, 2, 2],  M: [26, 4, 1],  Q: [24, 6, 2],  H: [28, 6, 2] },
};

// Coordonnées centrales des motifs d'alignement, par version
const ALIGNEMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Chaînes d'information de format (15 bits) : indexées [niveau][masque]
const FORMAT = {
  L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
  M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
  H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
};

// Information de version (18 bits), versions 7 à 10
const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

const MODE = { NUMERIQUE: 1, OCTET: 4 };

/* ------------------------------------------------- arithmétique de Galois --- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // polynôme générateur du corps GF(256)
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polynôme générateur de Reed-Solomon pour n codets de correction. */
function generateur(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const suivant = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      suivant[j] ^= poly[j];
      suivant[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = suivant;
  }
  return poly;
}

/** Codets de correction d'un bloc de données. */
export function correction(donnees, nbCorrection) {
  const gen = generateur(nbCorrection);
  const reste = new Uint8Array(donnees.length + nbCorrection);
  reste.set(donnees);
  for (let i = 0; i < donnees.length; i++) {
    const facteur = reste[i];
    if (facteur === 0) continue;
    for (let j = 0; j < gen.length; j++) reste[i + j] ^= mul(gen[j], facteur);
  }
  return reste.subarray(donnees.length);
}

/* ------------------------------------------------------------- flux de bits --- */

class FluxBits {
  constructor() { this.bits = []; }
  ajouter(valeur, longueur) {
    for (let i = longueur - 1; i >= 0; i--) this.bits.push((valeur >> i) & 1);
  }
  get longueur() { return this.bits.length; }
  versOctets() {
    const n = Math.ceil(this.bits.length / 8);
    const out = new Uint8Array(n);
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

const estNumerique = (texte) => /^[0-9]+$/.test(texte);

/** Longueur du champ « nombre de caractères », dépendante du mode et de la version. */
function tailleCompteur(mode, version) {
  if (version <= 9) return mode === MODE.NUMERIQUE ? 10 : 8;
  return mode === MODE.NUMERIQUE ? 12 : 16;
}

function encoderDonnees(texte, mode, version) {
  const flux = new FluxBits();
  flux.ajouter(mode, 4);

  if (mode === MODE.NUMERIQUE) {
    flux.ajouter(texte.length, tailleCompteur(mode, version));
    for (let i = 0; i < texte.length; i += 3) {
      const groupe = texte.slice(i, i + 3);
      flux.ajouter(parseInt(groupe, 10), groupe.length * 3 + 1);
    }
  } else {
    const octets = new TextEncoder().encode(texte);
    flux.ajouter(octets.length, tailleCompteur(mode, version));
    for (const o of octets) flux.ajouter(o, 8);
  }
  return flux;
}

/** Capacité utile (codets de données) d'une version / niveau donné. */
function capacite(version, niveau) {
  const [ecParBloc, g1, g2] = BLOCS[version][niveau];
  return CODETS_TOTAUX[version - 1] - ecParBloc * (g1 + g2);
}

function choisirVersion(texte, mode, niveau) {
  for (let v = 1; v <= 10; v++) {
    const bits = encoderDonnees(texte, mode, v).longueur;
    if (bits + 4 <= capacite(v, niveau) * 8) return v;
  }
  throw new Error('Texte trop long pour un QR de version 10 — raccourcissez l’URL.');
}

/** Données + terminateur + remplissage, puis entrelacement des blocs et de leur correction. */
function construireCodets(texte, mode, version, niveau) {
  const [ecParBloc, g1, g2] = BLOCS[version][niveau];
  const nbBlocs = g1 + g2;
  const totalDonnees = capacite(version, niveau);

  const flux = encoderDonnees(texte, mode, version);
  const maxBits = totalDonnees * 8;
  flux.ajouter(0, Math.min(4, maxBits - flux.longueur));          // terminateur
  while (flux.longueur % 8) flux.bits.push(0);                    // alignement octet

  const donnees = new Uint8Array(totalDonnees);
  donnees.set(flux.versOctets());
  const REMPLISSAGE = [0xec, 0x11];
  for (let i = Math.ceil(flux.longueur / 8), k = 0; i < totalDonnees; i++, k++) {
    donnees[i] = REMPLISSAGE[k % 2];
  }

  // Répartition en blocs : g1 blocs courts, g2 blocs d'un octet de plus.
  const tailleCourte = Math.floor(totalDonnees / nbBlocs);
  const blocs = [];
  let offset = 0;
  for (let i = 0; i < nbBlocs; i++) {
    const taille = tailleCourte + (i >= g1 ? 1 : 0);
    const bloc = donnees.subarray(offset, offset + taille);
    offset += taille;
    blocs.push({ donnees: bloc, correction: correction(bloc, ecParBloc) });
  }

  // Entrelacement : colonne par colonne, données d'abord puis correction.
  const sortie = [];
  const maxDonnees = Math.max(...blocs.map((b) => b.donnees.length));
  for (let i = 0; i < maxDonnees; i++) {
    for (const b of blocs) if (i < b.donnees.length) sortie.push(b.donnees[i]);
  }
  for (let i = 0; i < ecParBloc; i++) {
    for (const b of blocs) sortie.push(b.correction[i]);
  }
  return Uint8Array.from(sortie);
}

/* ------------------------------------------------------ construction du motif --- */

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

function grilleVide(taille) {
  return {
    modules: Array.from({ length: taille }, () => new Int8Array(taille).fill(-1)),
    reserve: Array.from({ length: taille }, () => new Uint8Array(taille)),
    taille,
  };
}

function poser(g, r, c, valeur, reserve = true) {
  if (r < 0 || c < 0 || r >= g.taille || c >= g.taille) return;
  g.modules[r][c] = valeur ? 1 : 0;
  if (reserve) g.reserve[r][c] = 1;
}

function motifsFixes(g, version) {
  const n = g.taille;

  // Motifs de détection de position + séparateurs
  for (const [dr, dc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const dedans = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const noir = dedans && (r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        poser(g, dr + r, dc + c, noir);
      }
    }
  }

  // Motifs de synchronisation
  for (let i = 8; i < n - 8; i++) {
    poser(g, 6, i, i % 2 === 0);
    poser(g, i, 6, i % 2 === 0);
  }

  // Motifs d'alignement, sauf sur les motifs de position
  const centres = ALIGNEMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          poser(g, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Module toujours noir
  poser(g, n - 8, 8, true);

  // Zones réservées à l'information de format
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { g.reserve[8][i] = 1; g.reserve[i][8] = 1; }
  }
  for (let i = 0; i < 8; i++) { g.reserve[8][n - 1 - i] = 1; g.reserve[n - 1 - i][8] = 1; }

  // Zones réservées à l'information de version
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) { g.reserve[i][n - 11 + j] = 1; g.reserve[n - 11 + j][i] = 1; }
    }
  }
}

/** Parcours en zigzag depuis le coin bas-droit — l'ordre de pose des codets. */
function* cheminDonnees(g) {
  const n = g.taille;
  let montant = true;
  for (let colonneDroite = n - 1; colonneDroite > 0; colonneDroite -= 2) {
    if (colonneDroite === 6) colonneDroite = 5; // la colonne de synchro est sautée
    for (let i = 0; i < n; i++) {
      const r = montant ? n - 1 - i : i;
      for (const c of [colonneDroite, colonneDroite - 1]) {
        if (!g.reserve[r][c]) yield [r, c];
      }
    }
    montant = !montant;
  }
}

function poserFormat(g, niveau, masque) {
  const n = g.taille;
  const bits = FORMAT[niveau][masque];
  for (let i = 0; i < 15; i++) {
    const b = ((bits >> i) & 1) === 1;
    if (i < 6) poser(g, 8, i, b);
    else if (i < 8) poser(g, 8, i + 1, b);
    else if (i === 8) poser(g, 7, 8, b);
    else poser(g, 14 - i, 8, b);

    if (i < 8) poser(g, 8, n - 1 - i, b);
    else poser(g, n - 15 + i, 8, b);
  }
}

function poserVersion(g, version) {
  if (version < 7) return;
  const n = g.taille;
  const bits = VERSION_INFO[version];
  for (let i = 0; i < 18; i++) {
    const b = ((bits >> i) & 1) === 1;
    poser(g, Math.floor(i / 3), n - 11 + (i % 3), b);
    poser(g, n - 11 + (i % 3), Math.floor(i / 3), b);
  }
}

/** Pénalités de la norme : plus le score est bas, meilleur est le masque. */
function penalite(modules) {
  const n = modules.length;
  let score = 0;

  const serie = (get) => {
    for (let a = 0; a < n; a++) {
      let compte = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) compte++;
        else { if (compte >= 5) score += compte - 2; compte = 1; }
      }
      if (compte >= 5) score += compte - 2;
    }
  };
  serie((a, b) => modules[a][b]);          // règle 1, lignes
  serie((a, b) => modules[b][a]);          // règle 1, colonnes

  for (let r = 0; r < n - 1; r++) {        // règle 2 : blocs 2x2
    for (let c = 0; c < n - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  const MOTIF = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];      // règle 3
  const MOTIF_INV = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const correspond = (get, a, b, motif) => motif.every((m, k) => get(a, b + k) === m);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b + 11 <= n; b++) {
      const ligne = (x, y) => modules[x][y];
      const colonne = (x, y) => modules[y][x];
      if (correspond(ligne, a, b, MOTIF) || correspond(ligne, a, b, MOTIF_INV)) score += 40;
      if (correspond(colonne, a, b, MOTIF) || correspond(colonne, a, b, MOTIF_INV)) score += 40;
    }
  }

  let noirs = 0;                            // règle 4 : équilibre noir/blanc
  for (const ligne of modules) for (const v of ligne) noirs += v;
  const ecart = Math.abs((noirs * 100) / (n * n) - 50);
  score += Math.floor(ecart / 5) * 10;

  return score;
}

/**
 * Encode un texte en matrice de modules booléens.
 * @returns {{taille:number, modules:boolean[][], version:number, masque:number}}
 */
export function encoder(texte, { niveau = 'M', masqueForce = null } = {}) {
  if (!texte) throw new Error('Texte vide');
  const mode = estNumerique(texte) ? MODE.NUMERIQUE : MODE.OCTET;
  const version = choisirVersion(texte, mode, niveau);
  const codets = construireCodets(texte, mode, version, niveau);
  const taille = version * 4 + 17;

  let meilleur = null;
  const masques = masqueForce === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [masqueForce];

  for (const masque of masques) {
    const g = grilleVide(taille);
    motifsFixes(g, version);
    poserVersion(g, version);

    let bit = 0;
    for (const [r, c] of cheminDonnees(g)) {
      const octet = codets[bit >> 3];
      const valeur = octet === undefined ? 0 : (octet >> (7 - (bit & 7))) & 1;
      g.modules[r][c] = (valeur === 1) !== MASQUES[masque](r, c) ? 1 : 0;
      bit++;
    }
    poserFormat(g, niveau, masque);

    const modules = g.modules.map((l) => Array.from(l, (v) => v === 1));
    const score = penalite(g.modules.map((l) => Array.from(l, (v) => (v === 1 ? 1 : 0))));
    if (!meilleur || score < meilleur.score) meilleur = { score, modules, masque };
  }

  return { taille, modules: meilleur.modules, version, masque: meilleur.masque };
}

/**
 * Rend le QR en SVG autonome (aucune image externe).
 * @param {string} texte contenu encodé
 */
export function versSVG(texte, {
  niveau = 'M', marge = 4, couleur = '#0A4176', fond = '#FFFFFF', titre = 'QR code',
} = {}) {
  const { modules, taille } = encoder(texte, { niveau });
  const total = taille + marge * 2;

  // Un seul chemin pour tous les modules : SVG compact et rendu net.
  let d = '';
  for (let r = 0; r < taille; r++) {
    for (let c = 0; c < taille; c++) {
      if (modules[r][c]) d += `M${c + marge} ${r + marge}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `shape-rendering="crispEdges" role="img" aria-label="${titre}">`
    + `<rect width="${total}" height="${total}" fill="${fond}"/>`
    + `<path d="${d}" fill="${couleur}"/></svg>`;
}
