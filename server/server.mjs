/**
 * Serveur du prototype : fichiers statiques + salon temps réel du mode animateur.
 * Zéro dépendance npm — `node server/server.mjs` suffit.
 *
 * Options :
 *   --port 8080          port d'écoute
 *   --url https://…      force l'URL affichée dans le QR code (tunnel, domaine…)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { brancherWebSocket } from './ws.mjs';
import { creerSalon } from './salon.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

const PORT = Number(argument('port', process.env.PORT || 8080));
const URL_FORCEE = argument('url', '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

/** Première adresse IPv4 non locale — celle que les téléphones du réseau peuvent joindre. */
function adresseLocale() {
  for (const cartes of Object.values(os.networkInterfaces())) {
    for (const c of cartes || []) {
      if (c.family === 'IPv4' && !c.internal) return c.address;
    }
  }
  return 'localhost';
}

const IP = adresseLocale();
const urlPublique = () => URL_FORCEE || `http://${IP}:${PORT}`;

/* ------------------------------------------------------------- statique --- */

async function servirFichier(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';

  // Confine strictement la résolution à la racine du projet.
  const cible = path.resolve(RACINE, '.' + rel);
  if (cible !== RACINE && !cible.startsWith(RACINE + path.sep)) {
    res.writeHead(403).end('403');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(cible);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — introuvable');
    return;
  }
  if (stat.isDirectory()) { res.writeHead(403).end('403'); return; }

  const ext = path.extname(cible).toLowerCase();
  const etag = `W/"${stat.size}-${stat.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }

  // Code et données revalidés à chaque appel (on édite le JSON en direct pendant
  // une démo) ; seuls les visuels, qui ne bougent pas, sont mis en cache.
  const figé = ['.png', '.jpg', '.svg', '.webp', '.ico', '.woff2', '.pdf'].includes(ext);
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': figé ? 'public, max-age=3600' : 'no-cache',
    etag,
  });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(cible).pipe(res);
}

const serveur = http.createServer((req, res) => {
  if (req.url === '/api/infos') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ url: urlPublique(), ip: IP, port: PORT }));
    return;
  }
  servirFichier(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end('500');
  });
});

/* ------------------------------------------------------------ temps réel --- */

const salon = await creerSalon({ racine: RACINE, urlPublique });
brancherWebSocket(serveur, (connexion, requete) => salon.accueillir(connexion, requete));

serveur.listen(PORT, () => {
  const l = (s) => console.log(s);
  l('');
  l('  \x1b[1mFrise digitale GRDF\x1b[0m — prototype');
  l('  ─────────────────────────────────────────────');
  l(`  Frise      \x1b[36mhttp://localhost:${PORT}/\x1b[0m`);
  l(`  Quiz solo  \x1b[36mhttp://localhost:${PORT}/quiz.html\x1b[0m`);
  l(`  Animateur  \x1b[36mhttp://localhost:${PORT}/host.html\x1b[0m`);
  l('');
  l(`  Sur le réseau (téléphones) : \x1b[32m${urlPublique()}\x1b[0m`);
  if (!URL_FORCEE && IP === 'localhost') {
    l('  \x1b[33m⚠ Aucune adresse réseau détectée — le QR code ne sera joignable que sur ce poste.\x1b[0m');
  }
  l('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { console.log('\n  Arrêt.'); serveur.close(() => process.exit(0)); });
}
