/**
 * Test de bout en bout du mode animateur : lance le serveur, ouvre un salon,
 * connecte trois joueurs, joue deux questions et vérifie scores et classement.
 * Utilise le client WebSocket natif de Node — la même poignée de main qu'un
 * navigateur, donc le serveur maison est réellement mis à l'épreuve.
 *
 * usage : node tools/test-salon.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { origineDepuis } from '../server/salon.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8137;

let echecs = 0;
const verifier = (nom, ok, detail = '') => {
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${nom}`);
  else { echecs++; console.log(`  \x1b[31m✗\x1b[0m ${nom}${detail ? `\n      ${detail}` : ''}`); }
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sonde une condition jusqu'à ce qu'elle soit vraie — les messages destinés à
 *  deux sockets différents n'arrivent pas forcément dans le même ordre. */
async function jusqua(condition, delai = 3000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (condition()) return true;
    await attendre(50);
  }
  return false;
}

/**
 * Client minimal. Chaque appel à attendreType consomme le message : un curseur
 * par type évite de relire indéfiniment le premier reçu.
 */
function client(nom) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const recus = [];
  const curseurs = new Map();
  const guetteurs = [];

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const index = recus.push(msg) - 1;
    for (let i = guetteurs.length - 1; i >= 0; i--) {
      if (guetteurs[i].type === msg.type) guetteurs.splice(i, 1)[0].resoudre(msg, index);
    }
  });

  return {
    nom, recus,
    pret: new Promise((r) => ws.addEventListener('open', r)),
    envoyer: (o) => ws.send(JSON.stringify(o)),
    attendreType(type, delai = 4000) {
      for (let i = curseurs.get(type) ?? 0; i < recus.length; i++) {
        if (recus[i].type === type) { curseurs.set(type, i + 1); return Promise.resolve(recus[i]); }
      }
      curseurs.set(type, recus.length);
      return new Promise((resoudre, rejeter) => {
        const t = setTimeout(
          () => rejeter(new Error(`${nom} : pas de « ${type} » en ${delai} ms`)), delai);
        guetteurs.push({
          type,
          resoudre: (m, index) => { curseurs.set(type, index + 1); clearTimeout(t); resoudre(m); },
        });
      });
    },
    dernier: (type) => [...recus].reverse().find((m) => m.type === type),
    fermer: () => ws.close(),
  };
}

/* --- URL publique du QR code, selon l'hébergement ------------------------- */

console.log("\nOrigine publique déduite de la requête\n");

const cas = (nom, headers, attendu) =>
  verifier(nom, origineDepuis({ headers }) === attendu,
    `attendu ${attendu} / obtenu ${origineDepuis({ headers })}`);

cas('Cloud Run (proxy HTTPS)',
  { 'x-forwarded-proto': 'https', host: 'frise-grdf-abc123.a.run.app' },
  'https://frise-grdf-abc123.a.run.app');
cas('chaîne de proxies : on garde le premier maillon',
  { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'frise.example.com, interne' },
  'https://frise.example.com');
cas('poste local : on retombe sur l\'adresse réseau',
  { host: 'localhost:8080' }, null);
cas('boucle locale IPv4 écartée', { host: '127.0.0.1:8080' }, null);
cas('boucle locale IPv6 écartée', { host: '[::1]:8080' }, null);
cas('IP du réseau local conservée',
  { host: '192.168.1.15:8080' }, 'http://192.168.1.15:8080');
cas('requête sans en-tête Host', {}, null);

console.log('\nMode animateur — partie complète\n');

const serveur = spawn('node', ['server/server.mjs', '--port', String(PORT)], {
  cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
});
let sortieServeur = '';
serveur.stdout.on('data', (d) => { sortieServeur += d; });
serveur.stderr.on('data', (d) => { sortieServeur += d; });

const terminer = (code) => {
  serveur.kill('SIGTERM');
  if (echecs || code) console.log(`\n--- sortie serveur ---\n${sortieServeur}`);
  console.log(echecs === 0 && !code
    ? '\n\x1b[32mTous les contrôles passent.\x1b[0m\n'
    : `\n\x1b[31m${echecs || 1} contrôle(s) en échec.\x1b[0m\n`);
  process.exit(echecs === 0 && !code ? 0 : 1);
};

try {
  await attendre(900);

  /* --- statique --- */
  const page = await fetch(`http://127.0.0.1:${PORT}/index.html`);
  verifier('index.html servi', page.ok && (await page.text()).includes('scene__cadre'));

  const donnees = await fetch(`http://127.0.0.1:${PORT}/data/solutions.json`);
  const solutions = await donnees.json();
  verifier('solutions.json servi et valide', Array.isArray(solutions) && solutions.length === 7);

  const remonte = await fetch(`http://127.0.0.1:${PORT}/../../../etc/passwd`);
  verifier('remontée de répertoire refusée', remonte.status === 404 || remonte.status === 403,
    `statut ${remonte.status}`);

  /* --- ouverture du salon --- */
  const animateur = client('animateur');
  await animateur.pret;
  animateur.envoyer({ type: 'creer' });
  const salon = await animateur.attendreType('salon');

  verifier('code de partie à 6 chiffres', /^\d{6}$/.test(salon.code), `reçu « ${salon.code} »`);
  verifier('URL de connexion avec le code', salon.url.includes(`code=${salon.code}`), salon.url);
  verifier('12 questions préparées', salon.nbQuestions === 12, `reçu ${salon.nbQuestions}`);

  /* --- connexion des joueurs ---
     Huit joueurs répartis en deux vagues couvrant chacune les 4 propositions :
     quelle que soit la bonne réponse, une vague rapide et une vague lente ont
     forcément un bon répondant, ce qui rend le test de la prime de rapidité
     déterministe. Un neuvième joueur ne répond jamais. */
  const RAPIDES = ['Alice', 'Bob', 'Chloé', 'Driss'];
  const LENTS = ['Elena', 'Farid', 'Gwen', 'Hugo'];
  const rapides = RAPIDES.map(client);
  const lents = LENTS.map(client);
  const muet = client('Inès');
  const joueurs = [...rapides, ...lents, muet];

  await Promise.all(joueurs.map((j) => j.pret));
  for (const j of joueurs) j.envoyer({ type: 'rejoindre', code: salon.code, pseudo: j.nom });
  await Promise.all(joueurs.map((j) => j.attendreType('rejoint')));

  await jusqua(() => animateur.dernier('joueurs')?.total === 9);
  const liste = animateur.dernier('joueurs');
  verifier('les 9 joueurs remontent à l\'animateur',
    liste?.total === 9 && liste.liste.length === 9, `reçu ${liste?.total}`);

  /* --- refus des cas limites --- */
  const intrus = client('intrus');
  await intrus.pret;
  intrus.envoyer({ type: 'rejoindre', code: '000000', pseudo: 'Fantôme' });
  const err1 = await intrus.attendreType('erreur');
  verifier('code inconnu refusé', /inconnu/i.test(err1.message), err1.message);

  intrus.envoyer({ type: 'rejoindre', code: salon.code, pseudo: 'Alice' });
  const err2 = await intrus.attendreType('erreur');
  verifier('pseudo en doublon refusé', /pris/i.test(err2.message), err2.message);
  intrus.fermer();

  /* --- un joueur ne doit pas pouvoir piloter la partie --- */
  rapides[0].envoyer({ type: 'suivante' });
  rapides[0].envoyer({ type: 'demarrer' });
  rapides[0].envoyer({ type: 'terminer' });
  rapides[0].envoyer({ type: 'creer' });
  await attendre(250);
  verifier('les commandes animateur sont refusées à un joueur',
    !rapides[0].dernier('salon') && !animateur.dernier('question') && !animateur.dernier('fin'),
    'un joueur a réussi à piloter la partie');

  /* --- question 1 --- */
  animateur.envoyer({ type: 'demarrer' });
  const q1 = await animateur.attendreType('question');
  verifier('question diffusée avec 4 propositions', q1.reponses.length === 4);
  verifier('la bonne réponse n\'est pas envoyée aux clients',
    !('bonne' in q1) && !('explication' in q1),
    `clés reçues : ${Object.keys(q1).join(', ')}`);

  const q1Joueur = await joueurs[0].attendreType('question');
  verifier('le joueur reçoit les mêmes propositions',
    JSON.stringify(q1Joueur.reponses) === JSON.stringify(q1.reponses));

  // Vague rapide : les 4 propositions couvertes tout de suite.
  await Promise.all(rapides.map(async (j, i) => {
    j.envoyer({ type: 'repondre', index: 0, choix: i });
    await j.attendreType('recu');
  }));

  await attendre(1600);

  // Vague lente : mêmes choix, plus tard.
  await Promise.all(lents.map(async (j, i) => {
    j.envoyer({ type: 'repondre', index: 0, choix: i });
    await j.attendreType('recu');
  }));

  // Seconde réponse d'un même joueur : doit être ignorée.
  rapides[0].envoyer({ type: 'repondre', index: 0, choix: 3 });
  // Choix hors bornes : ignoré aussi.
  muet.envoyer({ type: 'repondre', index: 0, choix: 99 });
  await attendre(200);

  const progression = animateur.dernier('progression');
  verifier('progression : 8 répondants sur 9',
    progression?.repondants === 8 && progression?.total === 9, JSON.stringify(progression));

  animateur.envoyer({ type: 'reveler' });
  const rev1 = await animateur.attendreType('revelation');
  verifier('révélation : indice de bonne réponse valide',
    Number.isInteger(rev1.bonne) && rev1.bonne >= 0 && rev1.bonne < 4, String(rev1.bonne));
  verifier('révélation : explication transmise',
    typeof rev1.explication === 'string' && rev1.explication.length > 10);
  verifier('répartition : 8 votes, 2 sur la bonne réponse',
    rev1.repartition.reduce((a, b) => a + b, 0) === 8 && rev1.repartition[rev1.bonne] === 2,
    JSON.stringify(rev1.repartition));

  const vRapides = await Promise.all(rapides.map((j) => j.attendreType('revelation')));
  const vLents = await Promise.all(lents.map((j) => j.attendreType('revelation')));
  const vMuet = await muet.attendreType('revelation');

  verifier('joueur sans réponse : aucun point', vMuet.aRepondu === false && vMuet.gagnes === 0);

  const justesRapides = vRapides.filter((v) => v.juste);
  const justesLents = vLents.filter((v) => v.juste);
  verifier('un seul bon répondant par vague',
    justesRapides.length === 1 && justesLents.length === 1,
    `${justesRapides.length} rapide(s), ${justesLents.length} lent(s)`);

  const rapide = justesRapides[0];
  const lent = justesLents[0];
  verifier('points dans la plage barème (1000 à 1500)',
    rapide.gagnes >= 1000 && rapide.gagnes <= 1500 && lent.gagnes >= 1000 && lent.gagnes <= 1500,
    `rapide ${rapide?.gagnes}, lent ${lent?.gagnes}`);
  verifier('prime de rapidité : le plus rapide marque plus',
    rapide.gagnes > lent.gagnes, `rapide ${rapide?.gagnes} vs lent ${lent?.gagnes}`);
  verifier('mauvaise réponse : zéro point',
    [...vRapides, ...vLents].filter((v) => !v.juste).every((v) => v.gagnes === 0));
  verifier('score cumulé = points de la question', rapide.score === rapide.gagnes);
  verifier('réponse hors bornes ignorée', vMuet.aRepondu === false);

  /* --- question 2 --- */
  animateur.envoyer({ type: 'suivante' });
  const q2 = await animateur.attendreType('question', 6000);
  verifier('passage à la question 2', q2.index === 1, `index ${q2.index}`);

  // Tout le monde répond : la révélation doit se déclencher sans attendre le chrono.
  await Promise.all(joueurs.map((j) => j.attendreType('question')));
  const debut = Date.now();
  await Promise.all(joueurs.map(async (j, i) => {
    j.envoyer({ type: 'repondre', index: 1, choix: i % 4 });
    await j.attendreType('recu');
  }));

  const rev2 = await animateur.attendreType('revelation', 5000);
  const delai = Date.now() - debut;
  verifier('révélation automatique quand tous ont répondu',
    rev2.index === 1 && delai < 3000, `${delai} ms`);
  verifier('classement renvoyé à l\'animateur',
    Array.isArray(rev2.classement) && rev2.classement.length === 8, `${rev2.classement?.length} lignes (8 max)`);
  verifier('classement trié par score décroissant',
    rev2.classement.every((j, i, t) => i === 0 || t[i - 1].score >= j.score),
    JSON.stringify(rev2.classement.map((j) => `${j.pseudo}:${j.score}`)));

  /* --- fin de partie --- */
  animateur.envoyer({ type: 'terminer' });
  const fin = await animateur.attendreType('fin');
  verifier('fin de partie : classement complet', fin.classement.length === 9, `${fin.classement.length} joueurs`);

  const finJoueur = await joueurs[0].attendreType('fin');
  verifier('le joueur reçoit son rang et le podium',
    finJoueur.rang >= 1 && finJoueur.rang <= 9 && finJoueur.podium.length === 3,
    JSON.stringify(finJoueur));

  /* --- départ de l'animateur --- */
  animateur.fermer();
  const orphelin = await joueurs[1].attendreType('erreur', 3000);
  verifier('les joueurs sont prévenus si l\'animateur part',
    /animateur/i.test(orphelin.message), orphelin.message);

  joueurs.forEach((j) => j.fermer());
  await attendre(200);
  terminer(0);
} catch (err) {
  console.log(`\n  \x1b[31m✗ ${err.message}\x1b[0m`);
  echecs++;
  terminer(1);
}
