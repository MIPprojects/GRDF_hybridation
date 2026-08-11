/**
 * Chargement des données JSON.
 *
 * Les fichiers de data/ sont chargés par fetch : il faut donc servir le dossier
 * en HTTP (voir README). En ouverture directe par file://, on l'explique
 * clairement à l'écran plutôt que de laisser une page blanche.
 */

const cache = new Map();

async function charger(chemin) {
  if (cache.has(chemin)) return cache.get(chemin);
  const p = fetch(chemin, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`${chemin} : HTTP ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      cache.delete(chemin);
      throw err;
    });
  cache.set(chemin, p);
  return p;
}

export const chargerConfig = () => charger('data/config.json');
export const chargerSolutions = () => charger('data/solutions.json');
export const chargerQuiz = () => charger('data/quiz.json');

/** Charge tout ce dont une page a besoin, en parallèle. */
export async function chargerTout() {
  const [config, solutions] = await Promise.all([chargerConfig(), chargerSolutions()]);
  return { config, solutions };
}

/**
 * Affiche un message lisible si les données ne sont pas accessibles — le cas le
 * plus fréquent étant un double-clic sur index.html (protocole file://).
 */
export function afficherErreurChargement(err) {
  const local = location.protocol === 'file:';
  const boite = document.createElement('div');
  boite.setAttribute('role', 'alert');
  boite.style.cssText = `
    position:fixed; inset:0; z-index:9999; display:grid; place-items:center;
    padding:2rem; background:#fff; font-family:var(--police, system-ui);`;
  boite.innerHTML = `
    <div style="max-width:34rem">
      <div style="width:4.6rem;height:4px;background:#FAB200;border-radius:2px;margin-bottom:1.2rem"></div>
      <h1 style="margin:0 0 .6rem;font-size:1.5rem;letter-spacing:-.02em;color:#0A4176">
        Les données ne se chargent pas
      </h1>
      <p style="margin:0 0 1rem;line-height:1.6;color:#4A6A88;font-size:.92rem">
        ${local
          ? "La page a été ouverte directement depuis le disque (<code>file://</code>). Les navigateurs interdisent alors la lecture des fichiers JSON."
          : `Erreur : <code>${String(err && err.message ? err.message : err)}</code>`}
      </p>
      <p style="margin:0 0 .5rem;font-weight:600;color:#0B2F52;font-size:.9rem">Lancez un serveur local depuis le dossier du projet :</p>
      <pre style="margin:0;padding:.9rem 1rem;border-radius:12px;background:#0A4176;color:#fff;font-size:.82rem;overflow:auto"><code>node server/server.mjs</code></pre>
      <p style="margin:.8rem 0 0;color:#4A6A88;font-size:.82rem">
        puis ouvrez <code>http://localhost:8080</code>.
      </p>
    </div>`;
  document.body.appendChild(boite);
  console.error(err);
}
