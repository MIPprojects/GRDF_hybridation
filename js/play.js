/**
 * Écran joueur (téléphone). Le code de partie est prérempli depuis le QR code.
 * Le client ne connaît jamais la bonne réponse avant la révélation par le serveur.
 */

import { connecterSalon } from './salon-client.js';
import { forme } from './formes.js';

const $ = (id) => document.getElementById(id);
const ecran = (id) =>
  document.querySelectorAll('.ecran').forEach((e) => e.classList.toggle('est-actif', e.id === id));

const etat = { pseudo: null, question: null, tic: null, restant: 0, rejoint: false };

// ?code=482913 depuis le QR code
const codeUrl = new URL(location.href).searchParams.get('code');
if (codeUrl && /^\d{6}$/.test(codeUrl)) {
  $('champCode').value = codeUrl;
  $('champPseudo').focus();
}

const salon = connecterSalon({
  surOuverture: () => { $('entreeAlerte').textContent = ''; },
  surFermeture: (tentatives) => {
    if (tentatives > 0 && !etat.rejoint) {
      $('entreeAlerte').textContent = 'Serveur injoignable — nouvelle tentative…';
    }
  },
  surMessage: traiter,
});

function traiter(msg) {
  switch (msg.type) {
    case 'rejoint':
      etat.rejoint = true;
      etat.pseudo = msg.pseudo;
      $('attentePseudo').textContent = msg.pseudo;
      return ecran('ecranAttente');
    case 'demarrage':
      return ($('attenteTexte').textContent = 'La partie commence…');
    case 'question': return afficherQuestion(msg);
    case 'recu': return ecran('ecranEnvoye');
    case 'revelation': return afficherVerdict(msg);
    case 'fin': return afficherFin(msg);
    case 'erreur': return afficherErreur(msg.message);
  }
}

function afficherErreur(message) {
  const cible = etat.rejoint ? $('jAlerte') : $('entreeAlerte');
  cible.textContent = message;
  if (!etat.rejoint) ecran('ecranEntree');
  $('formEntree')?.querySelector('button')?.removeAttribute('disabled');
}

/* ---------------------------------------------------------------- entrée --- */

$('formEntree').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('champCode').value.trim();
  if (!/^\d{6}$/.test(code)) {
    $('entreeAlerte').textContent = 'Le code de partie comporte 6 chiffres.';
    return;
  }
  if (!salon.pret) {
    $('entreeAlerte').textContent = 'Connexion au serveur en cours — réessayez dans un instant.';
    return;
  }
  e.target.querySelector('button').disabled = true;
  $('entreeAlerte').textContent = '';
  salon.envoyer({ type: 'rejoindre', code, pseudo: $('champPseudo').value });
});

/* -------------------------------------------------------------- question --- */

function afficherQuestion(msg) {
  etat.question = msg;
  ecran('ecranQuestion');

  $('jProgression').textContent = `${msg.index + 1} / ${msg.total}`;
  $('jBarre').style.width = `${(msg.index / msg.total) * 100}%`;
  $('jQuestion').textContent = msg.question;
  $('jAlerte').textContent = '';

  const hote = $('jReponses');
  hote.textContent = '';
  msg.reponses.forEach((texte, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reponse';
    b.innerHTML = `<span class="reponse__forme">${forme(i).svg}</span><span>${texte}</span>`;
    b.addEventListener('click', () => {
      [...hote.children].forEach((x) => { x.disabled = true; });
      b.classList.add('est-choisie');
      salon.envoyer({ type: 'repondre', index: msg.index, choix: i });
    });
    hote.appendChild(b);
  });

  lancerChrono(msg.duree);
}

function lancerChrono(duree) {
  clearInterval(etat.tic);
  etat.restant = duree;
  const rendre = () => { $('jChrono').textContent = `${Math.max(0, etat.restant)} s`; };
  rendre();
  etat.tic = setInterval(() => {
    etat.restant -= 1;
    rendre();
    if (etat.restant <= 0) clearInterval(etat.tic);
  }, 1000);
}

/* --------------------------------------------------------------- verdict --- */

function afficherVerdict(msg) {
  clearInterval(etat.tic);

  const juste = msg.juste;
  $('verdictIcone').textContent = !msg.aRepondu ? '⏱' : juste ? '✅' : '❌';
  $('verdictTitre').textContent = !msg.aRepondu
    ? 'Temps écoulé'
    : juste ? 'Bonne réponse !' : 'Raté cette fois';

  const points = $('verdictPoints');
  points.textContent = msg.gagnes > 0 ? `+ ${msg.gagnes} points` : 'Aucun point';
  points.classList.toggle('verdict__points--nul', msg.gagnes === 0);

  const serie = msg.serie >= 3 ? ` · série de ${msg.serie} 🔥` : '';
  $('verdictRang').innerHTML =
    `Score total <b>${msg.score}</b> · rang <b>${msg.rang}</b> sur ${msg.total}${serie}`;

  ecran('ecranVerdict');
}

function afficherFin(msg) {
  clearInterval(etat.tic);
  const medaille = ['🥇', '🥈', '🥉'][msg.rang - 1] || '🏁';
  $('finIcone').textContent = medaille;
  $('finTitre').textContent = `${msg.rang}ᵉ sur ${msg.total}`;
  $('finScore').textContent = `${msg.score} points`;

  const hote = $('finPodium');
  hote.textContent = '';
  msg.podium.forEach((j, i) => {
    const l = document.createElement('div');
    l.className = 'podium__ligne';
    l.style.animationDelay = `${i * 90}ms`;
    l.innerHTML = `
      <span class="podium__rang">${i + 1}</span>
      <span class="podium__nom">${j.pseudo}</span>
      <span class="podium__score">${j.score}</span>`;
    hote.appendChild(l);
  });

  ecran('ecranFin');
}
