/**
 * Salon temps réel du mode animateur (principe Kahoot!).
 *
 * L'animateur ouvre une partie et obtient un code à 6 chiffres ; les joueurs
 * rejoignent depuis leur téléphone via le QR code. Les questions et le barème
 * restent côté serveur : le client joueur ne reçoit jamais la bonne réponse
 * avant la révélation.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ANIMAUX = [
  'Renard', 'Hibou', 'Loutre', 'Blaireau', 'Martre', 'Héron', 'Chevreuil',
  'Bouvreuil', 'Mésange', 'Écureuil', 'Belette', 'Sittelle',
];

const alea = (n) => crypto.randomInt(n);

/**
 * Origine publique déduite de la requête de l'animateur.
 *
 * Derrière un proxy (Cloud Run, tunnel), l'adresse réseau de la machine n'a
 * aucun sens pour un téléphone : c'est l'hôte vu par le navigateur qui compte.
 * Une origine en localhost est écartée — elle ne serait pas joignable non plus.
 */
export function origineDepuis(requete) {
  const entete = (nom) => String(requete?.headers?.[nom] || '').split(',')[0].trim();
  const hote = entete('x-forwarded-host') || entete('host');
  if (!hote || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(hote)) return null;
  return `${entete('x-forwarded-proto') || 'http'}://${hote}`;
}

function melanger(tableau) {
  const t = [...tableau];
  for (let i = t.length - 1; i > 0; i--) {
    const j = alea(i + 1);
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

export async function creerSalon({ racine, urlPublique }) {
  const lire = async (f) => JSON.parse(await fsp.readFile(path.join(racine, 'data', f), 'utf8'));

  /** Les données sont relues à chaque partie : éditer le JSON ne demande pas de redémarrage. */
  async function chargerDonnees() {
    const [config, questions, solutions] = await Promise.all([
      lire('config.json'), lire('quiz.json'), lire('solutions.json'),
    ]);
    return { config, questions, solutions };
  }

  const parties = new Map(); // code -> partie

  function nouveauCode() {
    let code;
    do { code = String(100000 + alea(900000)); } while (parties.has(code));
    return code;
  }

  function diffuser(partie, message, { auxJoueurs = true, aLAnimateur = true } = {}) {
    if (aLAnimateur) partie.animateur?.envoyer(message);
    if (auxJoueurs) for (const j of partie.joueurs.values()) j.connexion?.envoyer(message);
  }

  const classement = (partie) =>
    [...partie.joueurs.values()]
      .map((j) => ({ id: j.id, pseudo: j.pseudo, score: j.score, serie: j.serie }))
      .sort((a, b) => b.score - a.score || a.pseudo.localeCompare(b.pseudo));

  const etatJoueurs = (partie) => ({
    type: 'joueurs',
    total: partie.joueurs.size,
    liste: [...partie.joueurs.values()].map((j) => ({ id: j.id, pseudo: j.pseudo })),
  });

  /* ------------------------------------------------------------ questions --- */

  function preparerQuestions({ config, questions }) {
    const q = config.quiz.melangerQuestions ? melanger(questions) : [...questions];
    return q.slice(0, Math.min(config.quiz.nbQuestions, q.length)).map((question) => {
      // On mélange les réponses et on retient où la bonne a atterri.
      const indices = config.quiz.melangerReponses
        ? melanger(question.reponses.map((_, i) => i))
        : question.reponses.map((_, i) => i);
      return {
        ...question,
        reponsesMelangees: indices.map((i) => question.reponses[i]),
        bonneMelangee: indices.indexOf(question.bonne),
      };
    });
  }

  function envoyerQuestion(partie) {
    const q = partie.questions[partie.index];
    if (!q) return terminer(partie);

    partie.debut = Date.now();
    partie.revelee = false;
    for (const j of partie.joueurs.values()) j.reponse = null;

    const commun = {
      type: 'question',
      index: partie.index,
      total: partie.questions.length,
      question: q.question,
      reponses: q.reponsesMelangees,
      theme: q.theme,
      duree: partie.duree,
    };
    diffuser(partie, commun);

    clearTimeout(partie.minuteur);
    partie.minuteur = setTimeout(() => reveler(partie), partie.duree * 1000 + 600);
  }

  function reveler(partie) {
    if (partie.revelee) return;
    partie.revelee = true;
    clearTimeout(partie.minuteur);

    const q = partie.questions[partie.index];
    const repartition = q.reponsesMelangees.map(() => 0);
    for (const j of partie.joueurs.values()) {
      if (j.reponse && typeof j.reponse.choix === 'number') repartition[j.reponse.choix]++;
    }

    const table = classement(partie);
    const rang = new Map(table.map((j, i) => [j.id, i + 1]));

    partie.animateur?.envoyer({
      type: 'revelation',
      index: partie.index,
      total: partie.questions.length,
      bonne: q.bonneMelangee,
      explication: q.explication,
      repartition,
      repondants: [...partie.joueurs.values()].filter((j) => j.reponse).length,
      classement: table.slice(0, 8),
    });

    for (const j of partie.joueurs.values()) {
      const juste = j.reponse?.choix === q.bonneMelangee;
      j.connexion?.envoyer({
        type: 'revelation',
        juste,
        aRepondu: Boolean(j.reponse),
        bonne: q.bonneMelangee,
        explication: q.explication,
        gagnes: j.reponse?.points ?? 0,
        score: j.score,
        serie: j.serie,
        rang: rang.get(j.id),
        total: partie.joueurs.size,
      });
    }
  }

  function terminer(partie) {
    clearTimeout(partie.minuteur);
    partie.etat = 'fini';
    const table = classement(partie);
    partie.animateur?.envoyer({ type: 'fin', classement: table });
    table.forEach((j, i) => {
      partie.joueurs.get(j.id)?.connexion?.envoyer({
        type: 'fin', rang: i + 1, total: table.length, score: j.score, podium: table.slice(0, 3),
      });
    });
  }

  /* ------------------------------------------------------------- messages --- */

  async function traiterAnimateur(connexion, msg, contexte) {
    if (msg.type === 'creer') {
      // une connexion déjà engagée (joueur ou animateur) ne peut pas ouvrir de partie
      if (contexte.role) return;
      const donnees = await chargerDonnees();
      const code = nouveauCode();
      const partie = {
        code,
        animateur: connexion,
        joueurs: new Map(),
        questions: preparerQuestions(donnees),
        index: -1,
        etat: 'attente',
        duree: donnees.config.quiz.secondesParQuestion,
        pointsBase: donnees.config.quiz.pointsBase,
        pointsVitesse: donnees.config.quiz.pointsVitesse,
        joueursMax: donnees.config.live.joueursMax,
        pseudoMax: donnees.config.live.pseudoMaxLongueur,
      };
      parties.set(code, partie);
      contexte.partie = partie;
      contexte.role = 'animateur';

      // priorité : URL forcée dans la config > hôte vu par le navigateur > IP locale
      const base = donnees.config.live.urlPublique || contexte.origine || urlPublique();
      connexion.envoyer({
        type: 'salon',
        code,
        url: `${base}/play.html?code=${code}`,
        urlBase: base,
        nbQuestions: partie.questions.length,
        duree: partie.duree,
      });
      return;
    }

    // Commandes de pilotage : réservées à l'animateur de cette partie. Sans ce
    // garde-fou, un téléphone joueur pourrait faire défiler les questions.
    const partie = contexte.partie;
    if (!partie || contexte.role !== 'animateur' || partie.animateur !== connexion) return;

    if (msg.type === 'demarrer' && partie.etat === 'attente') {
      if (partie.joueurs.size === 0) {
        connexion.envoyer({ type: 'erreur', message: 'Aucun joueur connecté.' });
        return;
      }
      partie.etat = 'en-cours';
      partie.index = 0;
      diffuser(partie, { type: 'demarrage', nbQuestions: partie.questions.length });
      setTimeout(() => envoyerQuestion(partie), 900);
    }

    if (msg.type === 'reveler') reveler(partie);

    if (msg.type === 'suivante' && partie.etat === 'en-cours') {
      if (!partie.revelee) reveler(partie);
      partie.index += 1;
      if (partie.index >= partie.questions.length) terminer(partie);
      else envoyerQuestion(partie);
    }

    if (msg.type === 'terminer') terminer(partie);
  }

  function traiterJoueur(connexion, msg, contexte) {
    if (msg.type === 'rejoindre') {
      const partie = parties.get(String(msg.code || '').trim());
      if (!partie) return connexion.envoyer({ type: 'erreur', message: 'Code de partie inconnu.' });
      if (partie.etat !== 'attente') return connexion.envoyer({ type: 'erreur', message: 'La partie a déjà commencé.' });
      if (partie.joueurs.size >= partie.joueursMax) return connexion.envoyer({ type: 'erreur', message: 'Partie complète.' });

      const propre = String(msg.pseudo || '').replace(/\s+/g, ' ').trim().slice(0, partie.pseudoMax);
      const pseudo = propre || `${ANIMAUX[alea(ANIMAUX.length)]} ${alea(90) + 10}`;
      if ([...partie.joueurs.values()].some((j) => j.pseudo.toLowerCase() === pseudo.toLowerCase())) {
        return connexion.envoyer({ type: 'erreur', message: 'Ce pseudo est déjà pris.' });
      }

      const joueur = {
        id: crypto.randomUUID(), pseudo, score: 0, serie: 0, reponse: null, connexion,
      };
      partie.joueurs.set(joueur.id, joueur);
      contexte.partie = partie;
      contexte.role = 'joueur';
      contexte.joueurId = joueur.id;

      connexion.envoyer({ type: 'rejoint', id: joueur.id, pseudo, code: partie.code });
      partie.animateur?.envoyer(etatJoueurs(partie));
      return;
    }

    const partie = contexte.partie;
    const joueur = partie?.joueurs.get(contexte.joueurId);
    if (!partie || !joueur) return;

    if (msg.type === 'repondre') {
      if (partie.etat !== 'en-cours' || partie.revelee || joueur.reponse) return;
      const q = partie.questions[partie.index];
      if (!q || msg.index !== partie.index) return;

      const choix = Number(msg.choix);
      if (!Number.isInteger(choix) || choix < 0 || choix >= q.reponsesMelangees.length) return;

      const ecoule = (Date.now() - partie.debut) / 1000;
      const juste = choix === q.bonneMelangee;
      let points = 0;
      if (juste) {
        // base + prime de rapidité décroissant linéairement sur la durée
        const rapidite = Math.max(0, 1 - ecoule / partie.duree);
        points = Math.round(partie.pointsBase + partie.pointsVitesse * rapidite);
        joueur.serie += 1;
        if (joueur.serie >= 3) points += 100 * (joueur.serie - 2); // bonus de série
      } else {
        joueur.serie = 0;
      }
      joueur.score += points;
      joueur.reponse = { choix, juste, points, ecoule };

      connexion.envoyer({ type: 'recu', choix, index: partie.index });
      partie.animateur?.envoyer({
        type: 'progression',
        repondants: [...partie.joueurs.values()].filter((j) => j.reponse).length,
        total: partie.joueurs.size,
      });

      // tout le monde a répondu : on révèle sans attendre la fin du chrono
      if ([...partie.joueurs.values()].every((j) => j.reponse)) {
        clearTimeout(partie.minuteur);
        partie.minuteur = setTimeout(() => reveler(partie), 700);
      }
    }
  }

  /* ------------------------------------------------------------ connexion --- */

  function accueillir(connexion, requete) {
    const contexte = { partie: null, role: null, joueurId: null, origine: origineDepuis(requete) };

    const battement = setInterval(() => connexion.ping(), 25000);

    connexion.on('message', (msg) => {
      if (!msg || typeof msg.type !== 'string') return;
      const traiter = ['creer', 'demarrer', 'reveler', 'suivante', 'terminer'].includes(msg.type)
        ? traiterAnimateur
        : traiterJoueur;
      Promise.resolve(traiter(connexion, msg, contexte)).catch((err) => {
        console.error('salon:', err);
        connexion.envoyer({ type: 'erreur', message: 'Erreur serveur.' });
      });
    });

    connexion.on('close', () => {
      clearInterval(battement);
      const partie = contexte.partie;
      if (!partie) return;

      if (contexte.role === 'animateur' && partie.animateur === connexion) {
        diffuser(partie, { type: 'erreur', message: "L'animateur a quitté la partie." }, { aLAnimateur: false });
        clearTimeout(partie.minuteur);
        parties.delete(partie.code);
      } else if (contexte.role === 'joueur') {
        const joueur = partie.joueurs.get(contexte.joueurId);
        if (joueur) joueur.connexion = null;
        // avant le départ, un joueur qui s'en va disparaît de la liste
        if (partie.etat === 'attente') partie.joueurs.delete(contexte.joueurId);
        partie.animateur?.envoyer(etatJoueurs(partie));
      }
    });
  }

  return { accueillir, parties };
}
