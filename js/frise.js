/**
 * Frise interactive — parcours en deux temps :
 *   1. on clique une cible du quartier -> la fiche s'ouvre sur l'essentiel
 *      (accroche, chiffres clés, barres de positionnement) ;
 *   2. « En savoir plus » déplie la description technique et les avantages.
 *
 * La scène zoome sur la maison choisie et la fiche en verre dépoli se pose du
 * côté opposé : l'illustration reste lisible derrière et autour de la fiche.
 */

import { chargerTout, afficherErreurChargement } from './data.js';
import { rendreMetriquesSolution, rendreLegende, rendreClassement } from './metrics.js';

const $ = (id) => document.getElementById(id);

const el = {
  cadre: $('cadre'), cibles: $('cibles'), voile: $('voile'),
  titre: $('titre'), sousTitre: $('sousTitre'), accroche: $('accroche'),
  fiche: $('fiche'), ficheDefilement: $('ficheDefilement'),
  numero: $('ficheNumero'), ficheTitre: $('ficheTitre'), picto: $('fichePicto'),
  ficheAccroche: $('ficheAccroche'), resume: $('ficheResume'), chiffres: $('ficheChiffres'),
  metriques: $('ficheMetriques'), legende: $('ficheLegende'),
  deplier: $('ficheDeplier'), deplierTexte: $('ficheDeplierTexte'), detail: $('ficheDetail'),
  descriptionTitre: $('ficheDescriptionTitre'), description: $('ficheDescription'),
  avClients: $('ficheAvantagesClients'), avFiliere: $('ficheAvantagesFiliere'), note: $('ficheNote'),
  prec: $('fichePrec'), suiv: $('ficheSuiv'), compteur: $('ficheCompteur'),
  fermer: $('ficheFermer'), ficheComparer: $('ficheComparer'),
  comparatif: $('comparatif'), comparatifAxes: $('comparatifAxes'), classement: $('classement'),
  comparatifAide: $('comparatifAide'), comparatifLegende: $('comparatifLegende'),
  comparatifFermer: $('comparatifFermer'), btnComparer: $('btnComparer'),
  contexte: $('contexte'), contexteTitre: $('contexteTitre'), contexteChapo: $('contexteChapo'),
  contexteGrille: $('contexteGrille'), contexteFermer: $('contexteFermer'), btnContexte: $('btnContexte'),
};

const etat = {
  config: null,
  solutions: [],
  courante: null,      // index de la solution ouverte, null si aucune
  depliee: false,
  axeComparatif: null,
  vues: new Set(),
};

/* ------------------------------------------------------------------ init --- */

try {
  const { config, solutions } = await chargerTout();
  etat.config = config;
  etat.solutions = solutions;
  etat.axeComparatif = config.metriques[0].id;
  demarrer();
} catch (err) {
  afficherErreurChargement(err);
}

function demarrer() {
  const { config } = etat;

  document.title = `${config.titre} — GRDF`;
  el.titre.textContent = config.titre;
  el.sousTitre.textContent = config.sousTitre;
  el.accroche.textContent = config.accroche;
  el.visuel = document.getElementById('visuel');
  el.visuel.src = config.visuel.image;

  construireCibles();
  rendreLegende(el.legende, config);
  rendreLegende(el.comparatifLegende, config);
  construireAxesComparatif();
  construireContexte();
  brancherEvenements();
  activerEditeurCibles();
  ouvrirDepuisAncre();
}

/** index.html#thpe-ssc ouvre directement la fiche — cible des liens du quiz. */
function ouvrirDepuisAncre() {
  const ouvrir = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const i = etat.solutions.findIndex((s) => s.id === id);
    if (i >= 0) ouvrirFiche(i, { deplier: true });
  };
  ouvrir();
  window.addEventListener('hashchange', ouvrir);
}

/* --------------------------------------------------------------- cibles --- */

function construireCibles() {
  el.cibles.textContent = '';
  etat.solutions.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cible';
    b.dataset.index = String(i);
    b.style.setProperty('--x', s.hotspot.x);
    b.style.setProperty('--y', s.hotspot.y);
    b.style.setProperty('--r', s.hotspot.r);
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `Solution ${s.num} : ${s.titreCourt}`);
    b.innerHTML = `
      <span class="cible__onde" style="--retard:${i * 420}ms"></span>
      <span class="cible__anneau"></span>
      <span class="cible__pastille" aria-hidden="true">${s.num}</span>`;
    b.addEventListener('click', () => ouvrirFiche(i));
    el.cibles.appendChild(b);
  });
}

/* ---------------------------------------------------------------- fiche --- */

function ouvrirFiche(index, { deplier = false } = {}) {
  const s = etat.solutions[index];
  if (!s) return;

  const changementDeFiche = etat.courante !== null && etat.courante !== index;
  etat.courante = index;
  etat.vues.add(s.id);

  const ancrage = s.ancrageFiche || 'droite';
  el.fiche.dataset.ancrage = ancrage;
  document.body.dataset.ancrage = ancrage;
  remplirFiche(s);
  replierFiche(deplier);

  document.body.classList.add('fiche-ouverte');
  el.fiche.classList.add('est-ouverte');
  cadrerSur(s);
  majCibles();
  fermerComparatif();
  fermerContexte();

  // au changement de fiche, on repart du haut du contenu
  if (changementDeFiche) el.ficheDefilement.scrollTop = 0;
  el.fiche.querySelector('.fiche__fermer').focus({ preventScroll: true });
}

function remplirFiche(s) {
  el.numero.textContent = `Solution ${s.num} sur ${etat.solutions.length}`;
  el.ficheTitre.textContent = s.titre;
  el.picto.src = s.picto;
  el.picto.alt = `Pictogramme : ${s.titreCourt}`;
  el.ficheAccroche.textContent = s.accroche;
  el.resume.textContent = s.resume;

  el.chiffres.textContent = '';
  (s.chiffresCles || []).forEach((c) => {
    const d = document.createElement('div');
    d.className = 'chiffre';
    d.innerHTML = `
      <span class="chiffre__valeur">${c.valeur}${c.unite ? `<span class="chiffre__unite">${c.unite}</span>` : ''}</span>
      <span class="chiffre__libelle">${c.libelle}</span>`;
    el.chiffres.appendChild(d);
  });

  rendreMetriquesSolution(el.metriques, s, etat.config, etat.solutions);

  el.descriptionTitre.textContent = s.descriptionTitre || 'Description technique';
  el.description.textContent = s.description;
  remplirListe(el.avClients, s.avantagesClients);
  remplirListe(el.avFiliere, s.avantagesFiliere);

  if (s.noteRedaction) {
    el.note.innerHTML = `<strong>Note de production :</strong> ${s.noteRedaction}`;
    el.note.hidden = false;
  } else {
    el.note.hidden = true;
  }

  el.compteur.textContent = `${s.num} / ${etat.solutions.length}`;
}

function remplirListe(ul, items) {
  ul.textContent = '';
  (items || []).forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    ul.appendChild(li);
  });
}

function replierFiche(deplier) {
  etat.depliee = Boolean(deplier);
  el.fiche.classList.toggle('est-depliee', etat.depliee);
  el.deplier.setAttribute('aria-expanded', String(etat.depliee));
  el.deplierTexte.textContent = etat.depliee ? 'Réduire la fiche' : 'En savoir plus';
}

function basculerDetail() {
  replierFiche(!etat.depliee);
  if (etat.depliee) {
    // on amène le début du détail sous les yeux, sans à-coup
    requestAnimationFrame(() => {
      el.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function fermerFiche() {
  etat.courante = null;
  delete document.body.dataset.ancrage;
  document.body.classList.remove('fiche-ouverte');
  el.fiche.classList.remove('est-ouverte');
  replierFiche(false);
  el.cadre.style.transform = '';
  majCibles();
}

function naviguer(pas) {
  if (etat.courante === null) return;
  const n = etat.solutions.length;
  ouvrirFiche((etat.courante + pas + n) % n, { deplier: etat.depliee });
}

function majCibles() {
  [...el.cibles.children].forEach((b, i) => {
    b.setAttribute('aria-pressed', String(i === etat.courante));
    b.classList.toggle('est-vue', etat.vues.has(etat.solutions[i].id));
  });
}

/**
 * Recadre la scène sur la maison sélectionnée. On zoome puis on translate de
 * façon à amener la bulle dans la moitié libre de l'écran — celle que la fiche
 * ne recouvre pas — pour que le verre repose sur du dessin, pas sur du blanc.
 */
function cadrerSur(s) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // dimensions réelles du cadre 16/9 avant transformation (mêmes calculs que le CSS)
  const W = Math.min(vw, (vh * 16) / 9);
  const H = Math.min(vh, (vw * 9) / 16);

  const etroit = window.matchMedia('(max-width: 900px)').matches;
  const zoom = etroit ? 2.4 : 1.55;

  // Où amener la bulle, en fraction de la fenêtre : en haut sur mobile (la fiche
  // occupe le bas), du côté opposé à la fiche sur grand écran.
  const viseeX = etroit ? 0.5 : ((s.ancrageFiche || 'droite') === 'droite' ? 0.33 : 0.67);
  const viseeY = etroit ? 0.19 : 0.48;

  const px = (s.hotspot.x / 100) * W;
  const py = (s.hotspot.y / 100) * H;

  // scale(k) translate(T) autour du centre : position finale = vw/2 + k·(p + T − W/2)
  const tx = ((viseeX * vw - vw / 2) / zoom + W / 2 - px) / W * 100;
  const ty = ((viseeY * vh - vh / 2) / zoom + H / 2 - py) / H * 100;

  el.cadre.style.transform = `scale(${zoom}) translate(${tx}%, ${ty}%)`;
  majFoyerVoile(viseeX * 100, viseeY * 100);
}

function majFoyerVoile(x, y) {
  el.voile.style.setProperty('--foyer-x', `${x}%`);
  el.voile.style.setProperty('--foyer-y', `${y}%`);
}

/* ----------------------------------------------------------- comparatif --- */

function construireAxesComparatif() {
  el.comparatifAxes.textContent = '';
  etat.config.metriques.forEach((axe) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'puce-axe';
    b.textContent = axe.libelle;
    b.setAttribute('aria-pressed', String(axe.id === etat.axeComparatif));
    b.addEventListener('click', () => {
      etat.axeComparatif = axe.id;
      construireAxesComparatif();
      majClassement();
    });
    el.comparatifAxes.appendChild(b);
  });
}

function majClassement() {
  const axe = etat.config.metriques.find((a) => a.id === etat.axeComparatif);
  el.comparatifAide.textContent = axe.aide;
  rendreClassement(el.classement, etat.axeComparatif, etat.solutions, etat.config, {
    actif: etat.courante !== null ? etat.solutions[etat.courante].id : null,
    onSelect: (s) => {
      fermerComparatif();
      ouvrirFiche(etat.solutions.indexOf(s));
    },
  });
}

function ouvrirComparatif() {
  majClassement();
  // la fiche passerait derrière le panneau : on la referme pour y voir clair
  if (etat.courante !== null) fermerFiche();
  el.comparatif.classList.add('est-ouvert');
  el.comparatifFermer.focus({ preventScroll: true });
}
function fermerComparatif() { el.comparatif.classList.remove('est-ouvert'); }

/* ------------------------------------------------------------- contexte --- */

function construireContexte() {
  const c = etat.config.contexte;
  el.contexteTitre.textContent = c.titre;
  el.contexteChapo.textContent = c.chapo;
  el.contexteGrille.textContent = '';
  c.sources.forEach((s) => {
    const d = document.createElement('div');
    d.className = 'contexte__carte';
    d.innerHTML = `
      <h3>${s.nom}</h3>
      <p class="contexte__reperes">${s.reperes}</p>
      <p>${s.texte}</p>`;
    el.contexteGrille.appendChild(d);
  });
}

function ouvrirContexte() {
  el.contexte.classList.add('est-ouvert');
  document.body.classList.add('fiche-ouverte');
  el.contexteFermer.focus({ preventScroll: true });
}
function fermerContexte() {
  el.contexte.classList.remove('est-ouvert');
  if (etat.courante === null) document.body.classList.remove('fiche-ouverte');
}

/* ------------------------------------------------------------ événements --- */

/**
 * La cible d'un keydown n'est pas toujours un Element (document quand rien n'a
 * le focus, ou événement synthétique) : on ne peut donc pas appeler closest()
 * sans précaution.
 */
function cibleDansSelecteur(evenement, selecteur) {
  const cible = evenement.target;
  return cible instanceof Element ? Boolean(cible.closest(selecteur)) : false;
}

function brancherEvenements() {
  el.fermer.addEventListener('click', fermerFiche);
  el.deplier.addEventListener('click', basculerDetail);
  el.prec.addEventListener('click', () => naviguer(-1));
  el.suiv.addEventListener('click', () => naviguer(1));
  el.ficheComparer.addEventListener('click', ouvrirComparatif);
  el.btnComparer.addEventListener('click', ouvrirComparatif);
  el.comparatifFermer.addEventListener('click', fermerComparatif);
  el.btnContexte.addEventListener('click', ouvrirContexte);
  el.contexteFermer.addEventListener('click', fermerContexte);

  // clic dans le vide = on referme
  document.querySelector('.scene').addEventListener('click', (e) => {
    if (e.target.closest('.cible')) return;
    if (etat.courante !== null) fermerFiche();
    fermerComparatif();
    fermerContexte();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el.comparatif.classList.contains('est-ouvert')) return fermerComparatif();
      if (el.contexte.classList.contains('est-ouvert')) return fermerContexte();
      if (etat.courante !== null) return fermerFiche();
    }
    if (etat.courante === null) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); naviguer(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); naviguer(-1); }
    if (e.key === ' ' && !cibleDansSelecteur(e, 'button, a, textarea')) { e.preventDefault(); basculerDetail(); }
  });
}

/* -------------------------------------------------- éditeur de cibles (E) --- */

/**
 * Outil de calage : E bascule le mode, on déplace les cibles à la souris, la
 * molette ajuste le rayon, et le panneau produit le JSON à recoller dans
 * data/solutions.json. Évite de retoucher les coordonnées à la main.
 */
function activerEditeurCibles() {
  let panneau = null;
  let actif = false;

  const majJSON = () => {
    if (!panneau) return;
    panneau.querySelector('textarea').value = etat.solutions
      .map((s) => `"${s.id}": { "x": ${s.hotspot.x.toFixed(2)}, "y": ${s.hotspot.y.toFixed(2)}, "r": ${s.hotspot.r.toFixed(2)} }`)
      .join(',\n');
  };

  const basculer = () => {
    actif = !actif;
    document.body.classList.toggle('mode-edition', actif);
    if (actif && !panneau) {
      panneau = document.createElement('aside');
      panneau.className = 'editeur verre';
      panneau.innerHTML = `
        <h3>Calage des cibles</h3>
        <p>Glissez une cible pour la déplacer, molette pour ajuster le rayon.
           Recopiez ensuite ces valeurs dans <code>data/solutions.json</code>.</p>
        <textarea readonly spellcheck="false"></textarea>
        <div class="editeur__actions">
          <button class="btn" data-action="copier">Copier</button>
          <button class="btn btn--fantome" data-action="quitter">Quitter (E)</button>
        </div>`;
      panneau.addEventListener('click', async (e) => {
        const action = e.target.dataset.action;
        if (action === 'copier') {
          try {
            await navigator.clipboard.writeText(panneau.querySelector('textarea').value);
            e.target.textContent = 'Copié !';
            setTimeout(() => { e.target.textContent = 'Copier'; }, 1400);
          } catch { panneau.querySelector('textarea').select(); }
        }
        if (action === 'quitter') basculer();
      });
      document.body.appendChild(panneau);
    }
    if (panneau) panneau.hidden = !actif;
    if (actif) { fermerFiche(); majJSON(); }
  };

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'e' || e.metaKey || e.ctrlKey) return;
    if (cibleDansSelecteur(e, 'input, textarea')) return;
    basculer();
  });

  let glisse = null;
  el.cibles.addEventListener('pointerdown', (e) => {
    if (!actif) return;
    const btn = e.target.closest('.cible');
    if (!btn) return;
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    glisse = { btn, s: etat.solutions[Number(btn.dataset.index)] };
  });

  el.cibles.addEventListener('pointermove', (e) => {
    if (!glisse) return;
    const r = el.cadre.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    glisse.s.hotspot.x = Math.max(0, Math.min(100, x));
    glisse.s.hotspot.y = Math.max(0, Math.min(100, y));
    glisse.btn.style.setProperty('--x', glisse.s.hotspot.x);
    glisse.btn.style.setProperty('--y', glisse.s.hotspot.y);
    majJSON();
  });

  const relacher = () => { glisse = null; };
  el.cibles.addEventListener('pointerup', relacher);
  el.cibles.addEventListener('pointercancel', relacher);

  el.cibles.addEventListener('wheel', (e) => {
    if (!actif) return;
    const btn = e.target.closest('.cible');
    if (!btn) return;
    e.preventDefault();
    const s = etat.solutions[Number(btn.dataset.index)];
    s.hotspot.r = Math.max(0.5, Math.min(12, s.hotspot.r - e.deltaY * 0.004));
    btn.style.setProperty('--r', s.hotspot.r);
    majJSON();
  }, { passive: false });

  // clic bloqué en mode édition : on ne veut pas ouvrir la fiche en déplaçant
  el.cibles.addEventListener('click', (e) => {
    if (actif) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
