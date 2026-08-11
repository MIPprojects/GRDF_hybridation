/**
 * Quiz solo : une question à la fois, correction commentée immédiatement,
 * bilan final avec renvoi vers la fiche de chaque solution.
 */

import { chargerConfig, chargerQuiz, chargerSolutions, afficherErreurChargement } from './data.js';
import { forme } from './formes.js';

const $ = (id) => document.getElementById(id);

const etat = {
  config: null,
  solutions: [],
  questions: [],
  index: 0,
  bonnes: 0,
  historique: [],
  verrouille: false,
};

function melanger(t) {
  const a = [...t];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

try {
  const [config, questions, solutions] = await Promise.all([
    chargerConfig(), chargerQuiz(), chargerSolutions(),
  ]);
  etat.config = config;
  etat.solutions = solutions;

  $('quizTitre').textContent = config.quiz.titre;
  $('quizSousTitre').textContent = config.quiz.sousTitre;
  document.title = `${config.quiz.titre} — GRDF`;

  $('btnDemarrer').addEventListener('click', () => demarrer(questions));
  $('btnRejouer').addEventListener('click', () => demarrer(questions));
  $('btnSuivante').addEventListener('click', suivante);
} catch (err) {
  afficherErreurChargement(err);
}

function ecran(id) {
  document.querySelectorAll('.ecran').forEach((e) => e.classList.toggle('est-actif', e.id === id));
}

function demarrer(toutes) {
  const { quiz } = etat.config;
  const pool = quiz.melangerQuestions ? melanger(toutes) : [...toutes];

  etat.questions = pool.slice(0, Math.min(quiz.nbQuestions, pool.length)).map((q) => {
    // On mélange les propositions et on retient l'indice de la bonne après brassage.
    const ordre = quiz.melangerReponses
      ? melanger(q.reponses.map((_, i) => i))
      : q.reponses.map((_, i) => i);
    return { ...q, propositions: ordre.map((i) => q.reponses[i]), bonneIndex: ordre.indexOf(q.bonne) };
  });

  etat.index = 0;
  etat.bonnes = 0;
  etat.historique = [];
  ecran('ecranQuestion');
  afficher();
}

function afficher() {
  const q = etat.questions[etat.index];
  etat.verrouille = false;

  $('progressionTexte').textContent = `Question ${etat.index + 1} / ${etat.questions.length}`;
  $('progressionBarre').style.width = `${(etat.index / etat.questions.length) * 100}%`;
  $('progressionScore').textContent = `${etat.bonnes} ✓`;
  $('scoreCourant').textContent = String(etat.bonnes);

  $('questionTheme').textContent = q.theme;
  $('questionTexte').textContent = q.question;

  const hote = $('reponses');
  hote.textContent = '';
  q.propositions.forEach((texte, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reponse';
    b.innerHTML = `<span class="reponse__forme">${forme(i).svg}</span><span>${texte}</span>`;
    b.addEventListener('click', () => repondre(i));
    hote.appendChild(b);
  });

  $('explication').classList.remove('est-visible');
  $('btnSuivante').hidden = true;
}

function repondre(choix) {
  if (etat.verrouille) return;
  etat.verrouille = true;

  const q = etat.questions[etat.index];
  const juste = choix === q.bonneIndex;
  if (juste) etat.bonnes += 1;
  etat.historique.push({ question: q, choix, juste });

  [...$('reponses').children].forEach((b, i) => {
    b.disabled = true;
    if (i === q.bonneIndex) {
      b.classList.add('est-juste');
      b.insertAdjacentHTML('beforeend', '<span class="reponse__marque" aria-hidden="true">✓</span>');
    } else if (i === choix) {
      b.classList.add('est-fausse');
      b.insertAdjacentHTML('beforeend', '<span class="reponse__marque" aria-hidden="true">✕</span>');
    } else {
      b.classList.add('est-estompee');
    }
  });

  $('explicationTexte').innerHTML = `<strong>${juste ? 'Exact.' : 'Pas tout à fait.'}</strong> ${q.explication}`;

  const lien = $('explicationLien');
  const solution = etat.solutions.find((s) => s.id === q.solutionId);
  if (solution) {
    lien.href = `index.html#${solution.id}`;
    lien.hidden = false;
    lien.firstChild.textContent = `Voir la fiche « ${solution.titreCourt} » `;
  } else {
    lien.hidden = true;
  }

  $('explication').classList.add('est-visible');
  $('progressionScore').textContent = `${etat.bonnes} ✓`;
  $('scoreCourant').textContent = String(etat.bonnes);

  const btn = $('btnSuivante');
  btn.hidden = false;
  btn.textContent = etat.index + 1 >= etat.questions.length ? 'Voir mon résultat' : 'Question suivante';
  btn.focus({ preventScroll: true });
}

function suivante() {
  etat.index += 1;
  if (etat.index >= etat.questions.length) return bilan();
  afficher();
  document.querySelector('.plaque').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bilan() {
  const total = etat.questions.length;
  const part = etat.bonnes / total;

  $('bilanScore').innerHTML = `${etat.bonnes}<span> / ${total}</span>`;
  $('bilanMention').textContent =
    part === 1 ? 'Sans faute — vous maîtrisez les 7 solutions.'
    : part >= 0.75 ? 'Très bon niveau, quelques chiffres à revoir.'
    : part >= 0.5 ? 'Bonne base : reprenez les fiches pour les détails.'
    : 'Un tour par la frise s\'impose avant le prochain rendez-vous client.';
  $('bilanDetail').textContent = `${Math.round(part * 100)} % de bonnes réponses.`;

  const revue = $('revue');
  revue.textContent = '';
  etat.historique.forEach(({ question, choix, juste }) => {
    const solution = etat.solutions.find((s) => s.id === question.solutionId);
    const ligne = document.createElement('div');
    ligne.className = 'revue__ligne';
    ligne.innerHTML = `
      <span class="revue__marque ${juste ? 'revue__marque--juste' : 'revue__marque--faux'}" aria-hidden="true">${juste ? '✓' : '✕'}</span>
      <span>
        <b>${question.question}</b>
        ${juste ? '' : `<p><em>Votre réponse :</em> ${question.propositions[choix]}<br><em>Bonne réponse :</em> ${question.propositions[question.bonneIndex]}</p>`}
        <p>${question.explication}${solution ? ` <a class="explication__lien" style="margin-top:.3rem" href="index.html#${solution.id}">Fiche « ${solution.titreCourt} »</a>` : ''}</p>
      </span>`;
    revue.appendChild(ligne);
  });

  ecran('ecranBilan');
  document.querySelector('.plaque').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
