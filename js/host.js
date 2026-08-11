/**
 * Écran de l'animateur : ouvre la partie, affiche le QR de connexion, projette
 * les questions et le classement. Le barème et les bonnes réponses restent au
 * serveur — cet écran ne fait qu'afficher ce qu'il reçoit.
 */

import { connecterSalon } from './salon-client.js';
import { versSVG } from './qrcode.js';
import { forme } from './formes.js';

const $ = (id) => document.getElementById(id);
const ecran = (id) =>
  document.querySelectorAll('.ecran').forEach((e) => e.classList.toggle('est-actif', e.id === id));

const etat = { code: null, question: null, tic: null, restant: 0, duree: 25, revelee: false };

const salon = connecterSalon({
  surOuverture: () => {
    $('salonAlerte').textContent = '';
    if (!etat.code) salon.envoyer({ type: 'creer' });
  },
  surFermeture: (tentatives) => {
    if (tentatives > 0) {
      $('salonAlerte').textContent = 'Connexion au serveur perdue — nouvelle tentative…';
    }
  },
  surMessage: traiter,
});

function traiter(msg) {
  switch (msg.type) {
    case 'salon': return afficherSalon(msg);
    case 'joueurs': return afficherJoueurs(msg);
    case 'demarrage': return ecran('ecranQuestion');
    case 'question': return afficherQuestion(msg);
    case 'progression': return majRepondants(msg);
    case 'revelation': return reveler(msg);
    case 'fin': return afficherFin(msg);
    case 'erreur': return ($('salonAlerte').textContent = msg.message);
  }
}

/* -------------------------------------------------------------- le salon --- */

function afficherSalon(msg) {
  etat.code = msg.code;
  etat.duree = msg.duree;

  $('salonSousTitre').textContent =
    `${msg.nbQuestions} questions · ${msg.duree} s par question`;
  $('salonCode').textContent = msg.code;
  $('salonUrl').textContent = msg.urlBase.replace(/^https?:\/\//, '');
  $('qr').innerHTML = versSVG(msg.url, {
    niveau: 'M', couleur: '#0A4176', fond: '#FFFFFF',
    titre: `Rejoindre la partie ${msg.code}`,
  });
  $('salonInfos').textContent = 'Le serveur doit rester allumé pendant la partie.';
}

function afficherJoueurs(msg) {
  $('salonNb').textContent = String(msg.total);
  $('btnLancer').disabled = msg.total === 0;
  $('salonVide').hidden = msg.total > 0;

  const hote = $('salonPastilles');
  hote.textContent = '';
  msg.liste.forEach((j) => {
    const p = document.createElement('span');
    p.className = 'pastille-joueur';
    p.textContent = j.pseudo;
    hote.appendChild(p);
  });
}

/* ----------------------------------------------------------- la question --- */

function afficherQuestion(msg) {
  etat.question = msg;
  etat.revelee = false;
  ecran('ecranQuestion');

  $('hProgressionTexte').textContent = `Question ${msg.index + 1} / ${msg.total}`;
  $('hProgressionBarre').style.width = `${(msg.index / msg.total) * 100}%`;
  $('hTheme').textContent = msg.theme;
  $('hQuestion').textContent = msg.question;
  $('hRepondants').textContent = '0 réponse';
  $('hScoreInfo').textContent = '';

  const hote = $('hReponses');
  hote.textContent = '';
  msg.reponses.forEach((texte, i) => {
    const b = document.createElement('div');
    b.className = 'reponse';
    b.innerHTML = `
      <span class="reponse__forme">${forme(i).svg}</span>
      <span>${texte}</span>
      <span class="reponse__compte" hidden>0</span>
      <span class="reponse__votes"></span>`;
    hote.appendChild(b);
  });

  $('hExplication').classList.remove('est-visible');
  $('btnReveler').hidden = false;
  $('btnSuivante').hidden = true;

  lancerChrono(msg.duree);
}

function majRepondants(msg) {
  $('hRepondants').textContent = `${msg.repondants} / ${msg.total} ont répondu`;
}

/* ---------------------------------------------------------- le chronomètre --- */

const CIRCONFERENCE = 2 * Math.PI * 18;

function lancerChrono(duree) {
  clearInterval(etat.tic);
  etat.restant = duree;

  const jauge = $('chronoJauge');
  jauge.style.strokeDasharray = String(CIRCONFERENCE);
  jauge.style.strokeDashoffset = '0';

  const rendre = () => {
    $('chronoTexte').textContent = String(Math.max(0, etat.restant));
    const part = Math.max(0, etat.restant) / duree;
    jauge.style.strokeDashoffset = String(CIRCONFERENCE * (1 - part));
    $('chrono').classList.toggle('est-urgent', etat.restant <= 5);
  };
  rendre();

  etat.tic = setInterval(() => {
    etat.restant -= 1;
    rendre();
    if (etat.restant <= 0) clearInterval(etat.tic);
  }, 1000);
}

function arreterChrono() {
  clearInterval(etat.tic);
  $('chrono').classList.remove('est-urgent');
}

/* ---------------------------------------------------------- la révélation --- */

function reveler(msg) {
  if (etat.revelee) return;
  etat.revelee = true;
  arreterChrono();

  const total = Math.max(1, msg.repartition.reduce((a, b) => a + b, 0));
  [...$('hReponses').children].forEach((b, i) => {
    const votes = msg.repartition[i] ?? 0;
    b.querySelector('.reponse__votes').style.width = `${(votes / total) * 100}%`;
    const compte = b.querySelector('.reponse__compte');
    compte.hidden = false;
    compte.textContent = String(votes);

    if (i === msg.bonne) {
      b.classList.add('est-juste');
      b.insertAdjacentHTML('beforeend', '<span class="reponse__marque" aria-hidden="true">✓</span>');
    } else {
      b.classList.add('est-estompee');
    }
  });

  $('hExplicationTexte').textContent = msg.explication;
  $('hExplication').classList.add('est-visible');
  $('hRepondants').textContent = `${msg.repondants} réponse(s)`;
  $('btnReveler').hidden = true;

  const derniere = msg.index + 1 >= msg.total;
  const btn = $('btnSuivante');
  btn.hidden = false;
  btn.textContent = derniere ? 'Voir le podium' : 'Question suivante';
  btn.focus({ preventScroll: true });

  etat.classement = msg.classement;
  $('hScoreInfo').textContent = msg.classement.length
    ? `En tête : ${msg.classement[0].pseudo} (${msg.classement[0].score} pts)`
    : '';
  $('clSousTitre').textContent = `Après la question ${msg.index + 1} sur ${msg.total}`;
  rendrePodium($('clPodium'), msg.classement);
}

function rendrePodium(hote, classement) {
  hote.textContent = '';
  classement.forEach((j, i) => {
    const l = document.createElement('div');
    l.className = 'podium__ligne';
    l.style.animationDelay = `${i * 70}ms`;
    l.innerHTML = `
      <span class="podium__rang">${i + 1}</span>
      <span class="podium__nom">${j.pseudo}</span>
      <span class="podium__score">${j.score}</span>`;
    hote.appendChild(l);
  });
}

function afficherFin(msg) {
  arreterChrono();
  rendrePodium($('finPodium'), msg.classement);
  ecran('ecranFin');
}

/* ------------------------------------------------------------- commandes --- */

$('btnLancer').addEventListener('click', () => {
  $('btnLancer').disabled = true;
  salon.envoyer({ type: 'demarrer' });
});
$('btnReveler').addEventListener('click', () => salon.envoyer({ type: 'reveler' }));

const suivante = () => salon.envoyer({ type: 'suivante' });
$('btnSuivante').addEventListener('click', suivante);
$('btnSuivante2').addEventListener('click', suivante);

$('btnRelancer').addEventListener('click', () => location.reload());

// Barre d'espace : révéler puis passer à la suite, sans quitter l'écran des yeux
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.target.closest('button, a, input')) return;
  e.preventDefault();
  if (!$('ecranQuestion').classList.contains('est-actif')) return;
  if (etat.revelee) suivante();
  else salon.envoyer({ type: 'reveler' });
});
