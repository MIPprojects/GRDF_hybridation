/**
 * Rendu des barres de comparaison.
 *
 * Parti pris : des barres horizontales plutôt qu'un radar. Sur 5 axes et 7
 * solutions, la barre se lit d'un coup d'œil et se compare verticalement, ce
 * qu'un graphe en toile d'araignée ne permet pas.
 *
 * Chaque barre porte sa provenance : pastille pleine = chiffre présent dans le
 * document source, pastille creuse + hachures = estimation de mise en scène.
 */

export const SOURCE_DOC = 'document';

/** Moyenne d'un axe sur l'ensemble des solutions — sert de repère sur la piste. */
export function moyenneAxe(solutions, axeId) {
  const vals = solutions.map((s) => s.metrics?.[axeId]?.v).filter((v) => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function creerPiste({ valeur, max, couleur, estimation, repere, delai = 0 }) {
  const piste = document.createElement('div');
  piste.className = 'metrique__piste';

  const barre = document.createElement('div');
  barre.className = 'metrique__barre' + (estimation ? ' metrique__barre--estimation' : '');
  barre.style.setProperty('--barre-couleur', couleur);
  barre.style.setProperty('--barre-delai', `${delai}ms`);
  barre.style.setProperty('--barre-largeur', `${Math.max(0, Math.min(1, valeur / max)) * 100}%`);
  piste.appendChild(barre);

  if (typeof repere === 'number' && repere > 0) {
    const r = document.createElement('div');
    r.className = 'metrique__repere';
    r.style.left = `${(repere / max) * 100}%`;
    r.title = `Moyenne des 7 solutions : ${repere.toFixed(1)} / ${max}`;
    piste.appendChild(r);
  }

  return piste;
}

/**
 * Bloc de barres d'une solution : un axe par ligne.
 * @param {HTMLElement} hote conteneur (vidé)
 */
export function rendreMetriquesSolution(hote, solution, config, solutions) {
  hote.textContent = '';
  const max = config.echelleMetriques.max;

  config.metriques.forEach((axe, i) => {
    const m = solution.metrics?.[axe.id];
    if (!m) return;
    const estimation = m.source !== SOURCE_DOC;

    const ligne = document.createElement('div');
    ligne.className = 'metrique';

    const nom = document.createElement('span');
    nom.className = 'metrique__nom';
    nom.textContent = axe.libelle;
    nom.title = axe.aide;

    const valeur = document.createElement('span');
    valeur.className = 'metrique__valeur';
    const pastille = document.createElement('i');
    pastille.className = 'metrique__source' + (estimation ? ' metrique__source--estimation' : '');
    pastille.title = estimation
      ? config.echelleMetriques.legendeEstimation
      : config.echelleMetriques.legendeDocument;
    valeur.append(m.label ?? '', pastille);

    ligne.append(nom, valeur, creerPiste({
      valeur: m.v,
      max,
      couleur: axe.couleur,
      estimation,
      repere: moyenneAxe(solutions, axe.id),
      delai: i * 70,
    }));
    hote.appendChild(ligne);
  });
}

/** Légende commune (pastille pleine / pastille creuse / trait de moyenne). */
export function rendreLegende(hote, config) {
  hote.innerHTML = `
    <span><i class="metrique__source"></i>${config.echelleMetriques.legendeDocument}</span>
    <span><i class="metrique__source metrique__source--estimation"></i>${config.echelleMetriques.legendeEstimation}</span>
    <span><i style="display:inline-block;width:2px;height:11px;background:var(--bleu-nuit);opacity:.45;border-radius:2px"></i>Moyenne des 7 solutions</span>`;
}

/**
 * Classement des 7 solutions sur un axe donné, du plus fort au plus faible.
 * @param {(s:object)=>void} onSelect appelé au clic sur une ligne
 */
export function rendreClassement(hote, axeId, solutions, config, { actif, onSelect } = {}) {
  hote.textContent = '';
  const axe = config.metriques.find((a) => a.id === axeId);
  const max = config.echelleMetriques.max;
  const moyenne = moyenneAxe(solutions, axeId);

  [...solutions]
    .sort((a, b) => (b.metrics?.[axeId]?.v ?? 0) - (a.metrics?.[axeId]?.v ?? 0))
    .forEach((s, i) => {
      const m = s.metrics?.[axeId];
      if (!m) return;
      const estimation = m.source !== SOURCE_DOC;

      const ligne = document.createElement('button');
      ligne.type = 'button';
      ligne.className = 'classement__ligne' + (s.id === actif ? ' est-active' : '');
      ligne.setAttribute('aria-label', `${s.titreCourt} — ${axe.libelle} : ${m.label}`);

      const picto = document.createElement('img');
      picto.className = 'classement__picto';
      picto.src = s.picto;
      picto.alt = '';

      const nom = document.createElement('span');
      nom.className = 'classement__nom';
      nom.textContent = `${s.num}. ${s.titreCourt}`;

      const label = document.createElement('span');
      label.className = 'classement__label';
      const pastille = document.createElement('i');
      pastille.className = 'metrique__source' + (estimation ? ' metrique__source--estimation' : '');
      label.append(m.label ?? '', pastille);

      ligne.append(picto, nom, creerPiste({
        valeur: m.v,
        max,
        couleur: axe.couleur,
        estimation,
        repere: moyenne,
        delai: i * 55,
      }), label);

      if (onSelect) ligne.addEventListener('click', () => onSelect(s));
      hote.appendChild(ligne);
    });
}
