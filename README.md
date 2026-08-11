# Frise digitale GRDF — « Choisir le gaz, c'est choisir l'avenir »

Prototype interactif reprenant la base graphique du PDF `20260608_Frise_digitale_CAPEB.pdf`
et l'intégralité du contenu de `CAPEB_Frise_digitale_synthese_contenu_1.md`.

Trois modules, une seule base de données JSON :

| Écran | Fichier | Rôle |
|---|---|---|
| **Frise** | `index.html` | Le quartier, 7 cibles cliquables, fiches en verre dépoli en 2 étapes |
| **Quiz solo** | `quiz.html` | 12 questions tirées au sort, correction commentée, renvoi vers les fiches |
| **Mode animateur** | `host.html` + `play.html` | Partie collective type Kahoot!, QR code de connexion, classement en direct |

---

## Démarrer

```bash
node server/server.mjs
```

Puis <http://localhost:8080>. Aucune dépendance npm, aucun accès réseau : Node 18+ suffit.

> **Pourquoi un serveur ?** Les contenus sont dans `data/*.json`, chargés par `fetch`.
> Un double-clic sur `index.html` (protocole `file://`) est bloqué par le navigateur —
> la page affiche alors un message expliquant la manœuvre.

Options :

```bash
node server/server.mjs --port 3000
node server/server.mjs --url https://mon-tunnel.example.com
```

`--url` force l'adresse encodée dans le QR code, utile derrière un tunnel (ngrok,
Cloudflare Tunnel) quand les téléphones ne sont pas sur le même Wi-Fi.

---

## Le parcours en deux temps

C'est le cœur de la demande : **une cible → un résumé → le détail à la demande.**

**Étape 1 — au clic sur une cible.** La scène zoome sur la maison concernée et la fiche
se pose du côté opposé, de sorte que le verre repose sur le dessin et non sur du blanc.
La fiche montre l'accroche, les chiffres clés sourcés et les 5 barres de positionnement.

**Étape 2 — « En savoir plus ».** Déplie la description technique et les avantages,
séparés en *Pour le client* / *Pour la filière* comme dans le document source.

Raccourcis : `←` `→` pour changer de solution, `Espace` pour déplier, `Échap` pour fermer.

---

## Éditer les contenus

Tout est dans `data/`, sans toucher au code.

### `data/solutions.json` — les 7 fiches

Un objet par solution. Les champs qui comptent :

| Champ | Effet |
|---|---|
| `titre`, `titreCourt` | Titre de la fiche / libellé court dans le comparatif |
| `accroche` | Phrase bénéfice, en exergue avec le filet vert |
| `resume` | Le « bref résumé » de l'étape 1 |
| `chiffresCles[]` | Encadrés `valeur` + `unite` + `libelle` |
| `descriptionTitre`, `description` | Bloc de l'étape 2 |
| `avantagesClients[]`, `avantagesFiliere[]` | Les deux colonnes de l'étape 2 |
| `noteRedaction` | Encadré jaune « note de production » (optionnel) |
| `hotspot` | Position de la cible, en % du visuel |
| `ancrageFiche` | `"droite"` ou `"gauche"` — de quel côté la fiche s'ouvre |
| `metrics` | Les 5 barres (voir ci-dessous) |

### `data/quiz.json` — les questions

```json
{
  "question": "…",
  "reponses": ["la bonne", "une fausse", "une fausse", "une fausse"],
  "bonne": 0,
  "explication": "…",
  "solutionId": "pac-hybride",
  "theme": "Performance",
  "difficulte": 2
}
```

**Convention d'écriture : mettez toujours la bonne réponse en premier et laissez
`"bonne": 0`.** Les propositions sont mélangées à l'affichage (`melangerReponses`),
donc l'ordre du fichier n'est jamais celui vu par le joueur. `solutionId` crée le lien
« Voir la fiche » et doit correspondre à un `id` de `solutions.json` (ou `null`).

Le fichier contient 18 questions ; `config.json → quiz.nbQuestions` fixe combien sont
tirées par partie (12 par défaut).

### `data/config.json` — réglages

Palette, libellés des axes, durée par question, barème, nombre de questions, textes
du bloc « gaz renouvelables ». Les couleurs ont été relevées au pixel dans
l'illustration source.

---

## Les barres de comparaison

Des barres horizontales, pas de radar : sur 5 axes et 7 solutions, la barre se compare
verticalement d'un seul coup d'œil, ce que la toile d'araignée ne permet pas.

Cinq axes : économies d'énergie, gain DPE, réduction CO₂, part d'ENR, accessibilité
budget (échelle inversée — barre longue = investissement contenu).

Chaque barre porte trois informations :

- sa **longueur** (positionnement relatif des 7 solutions entre elles, sur 5) ;
- son **libellé** (le chiffre réel quand il existe : « 30 à 40 % », « +2 classes ») ;
- sa **provenance** — pastille pleine = chiffre présent dans le document source,
  pastille creuse + hachures = estimation.

Un trait vertical marque la moyenne des 7 solutions sur l'axe.

> ### ⚠ Point à arbitrer avec GRDF
>
> Le document source ne chiffre pas les 7 solutions sur les mêmes axes : la fiche 4
> (PAC hybride) a trois chiffres, la fiche 7 (SSC) un seul, la fiche 1 (poêle à bois)
> aucun. **Les valeurs `v` marquées `"source": "estimation"` sont un positionnement
> éditorial de ma part**, cohérent mais non sourcé — 12 des 35 cases (23 sont sourcées).
> Elles sont signalées à l'écran et listées dans `data/solutions.json` ; à valider ou
> corriger avant toute diffusion. Les valeurs `"source": "document"` reprennent
> fidèlement le contenu du MD.
>
> Autre point relevé dans le document source : la fiche 3 est la seule à intituler son
> bloc « Principe et fonctionnement » au lieu de « Description technique ». Les deux
> intitulés sont conservés tels quels ; un encadré jaune le signale dans la fiche.

---

## Mode animateur (type Kahoot!)

1. Ouvrez `host.html` sur l'écran projeté → un QR code et un code à 6 chiffres.
2. Les participants scannent : le code est prérempli, ils saisissent un pseudo.
3. « Lancer la partie » : chaque question part simultanément sur tous les téléphones.
4. Barre `Espace` pour révéler puis passer à la suivante, sans quitter l'écran des yeux.

Barème : 1000 points par bonne réponse, plus une prime de rapidité jusqu'à 500 points
décroissant linéairement sur la durée, plus un bonus de série à partir de 3 bonnes
réponses consécutives. Réglable dans `config.json`.

Les bonnes réponses **ne sont jamais envoyées aux téléphones avant la révélation** :
le serveur seul détient le corrigé et calcule les scores.

**Réseau.** Les téléphones doivent joindre le poste animateur. En Wi-Fi partagé, l'IP
locale affichée sous le QR suffit. Sur un réseau qui isole les clients (Wi-Fi invité
d'hôtel, réseau d'entreprise), passez par un tunnel et l'option `--url`.

---

## Déployer sur Cloud Run

### En ligne

<https://frise-grdf-dg4kewooca-od.a.run.app>

| | |
|---|---|
| Frise | <https://frise-grdf-dg4kewooca-od.a.run.app/> |
| Quiz solo | <https://frise-grdf-dg4kewooca-od.a.run.app/quiz.html> |
| Animateur | <https://frise-grdf-dg4kewooca-od.a.run.app/host.html> |

Projet `gen-lang-client-0804069470` (DIGITAL AI FACTORY), région `europe-west9`,
service `frise-grdf`, accès public. L'app est sur l'internet public : l'URL n'est
pas devinable mais n'est pas protégée — à garder en tête tant que les chiffres ne
sont pas validés par GRDF.

### Redéployer

```bash
gcloud auth login
./deploy-cloudrun.sh gen-lang-client-0804069470
```

Le script construit l'image depuis le `Dockerfile` (aucune dépendance npm à
installer) et déploie en région `europe-west9` (Paris) sous le nom `frise-grdf`,
tous deux surchargeables en arguments.

**Les options de déploiement ne sont pas cosmétiques.** Les parties du mode
animateur vivent en mémoire vive, ce qui contraint la configuration :

| Option | Pourquoi |
|---|---|
| `--min-instances 1 --max-instances 1` | Animateur et joueurs doivent atterrir sur **la même** instance. À deux instances, un joueur peut ne jamais voir la partie de l'animateur. |
| `--no-cpu-throttling` | Le minuteur qui révèle la réponse à la fin du chrono est un `setTimeout` : sans CPU alloué en continu, il ne se déclencherait pas. |
| `--timeout 3600` | Chaque connexion WebSocket compte comme une requête. Le défaut de 300 s couperait la partie au bout de 5 minutes. |
| `--concurrency 250` | Idem : une connexion = une requête. Le défaut de 80 plafonnerait la salle à 79 participants. |
| `--allow-unauthenticated` | Les participants scannent le QR sur leur téléphone : ils ne peuvent pas s'authentifier avec un compte Google. |

Corollaire à connaître : **un redéploiement met fin aux parties en cours**, puisque
l'instance est remplacée. À faire en dehors des sessions d'animation.

Le QR code n'a rien à configurer : l'URL publique est déduite de l'en-tête `Host`
de la requête (`x-forwarded-proto` / `x-forwarded-host` derrière le proxy Cloud Run),
et non de l'adresse réseau du conteneur — qui ne serait joignable par personne.

---

## Recaler les cibles

Si l'illustration est retouchée, les 7 cibles se recalent sans éditer le JSON à la main :
sur la frise, tapez **`E`**. Les cibles deviennent déplaçables à la souris, la molette
ajuste le rayon, et un panneau produit le JSON à recopier dans `data/solutions.json`.

Les positions livrées ont été mesurées automatiquement sur l'illustration :

```bash
node tools/detect-hotspots.mjs "chemin/vers/ville_sans_texte_HD.png"
```

L'outil isole le filet bleu des bulles, regroupe les pixels connexes et ajuste un cercle
par moindres carrés sur chaque anneau. Les 7 bulles sont retrouvées, avec un taux
d'appariement de 57 à 90 % selon que l'illustration déborde ou non du cercle.

---

## Retraitement des visuels

Les images livrées dans `ASSETS_2D.zip` ont été préparées par deux outils sans dépendance
(moteur PNG maison dans `tools/png.mjs`) :

```bash
node tools/crop-pictos.mjs <dossier_source> assets/pictos 560
node tools/prepare-background.mjs <ville_sans_texte_HD.png> assets
```

- **`crop-pictos.mjs`** — les 7 pictogrammes arrivaient dans une bulle blanche opaque de
  1860×1352 px. L'outil rend le disque blanc transparent par diffusion depuis les bords
  (les blancs *intérieurs* — corps de chaudière, ballon — sont préservés car enclos par
  un trait bleu), détecte la boîte de l'illustration seule par érosion morphologique,
  puis réduit. Résultat : 3 à 26 Ko par picto, fond transparent.
- **`prepare-background.mjs`** — décline le fond 8000×4500 en 4000×2250 (623 Ko) et en
  vignette 1000×562 utilisée comme arrière-plan flouté du quiz.

---

## Contrôles automatiques

```bash
node tools/test-qrcode.mjs   # encodeur QR
node tools/test-salon.mjs    # mode animateur, de bout en bout
```

**QR code** (`js/qrcode.js`, encodeur écrit pour le projet, aucun CDN) : validé contre le
vecteur de référence de l'annexe I d'ISO/IEC 18004, par aller-retour
encodage → matrice → relecture → décodage sur 6 chaînes, et sur les invariants de
structure. Les QR produits ont par ailleurs été **relus par CoreImage**, le moteur qui
équipe l'appareil photo des iPhone.

**Mode animateur** : 30 contrôles sur une partie complète — ouverture de salon, connexion
de 9 joueurs, refus des codes inconnus et des pseudos en doublon, non-divulgation du
corrigé, barème et prime de rapidité, répartition des votes, révélation automatique
quand tout le monde a répondu, classement, départ de l'animateur.

---

## Arborescence

```
Dockerfile            image Cloud Run (runtime Node seul)
deploy-cloudrun.sh    déploiement en une commande

index.html            frise interactive
quiz.html             quiz solo
host.html             écran animateur (QR code, questions projetées)
play.html             écran joueur (téléphone)

data/
  config.json         palette, axes, barème, textes cadres
  solutions.json      les 7 fiches
  quiz.json           18 questions

css/                  base (jetons, verre, barres) · frise · jeu
js/                   frise, quiz, host, play, metrics, qrcode, data…
assets/               ville.png, ville-lowres.png, pictos/
server/               server.mjs (statique + salon) · ws.mjs · salon.mjs
tools/                préparation des visuels et tests
```

---

## Limites connues

- **Le mode animateur exige que le serveur tourne.** Les parties vivent en mémoire :
  redémarrer le serveur — ou redéployer sur Cloud Run — met fin aux parties en cours.
  C'est aussi ce qui impose l'instance unique côté Cloud Run.
- **Un joueur qui perd le réseau** se reconnecte automatiquement mais revient à l'écran
  de connexion : son score reste au serveur, il faut ressaisir le code et le pseudo.
- **Le zoom de la scène** est calé pour un écran large (16/9). Sous 900 px de large, la
  fiche passe en tiroir bas et le zoom est neutralisé.
- **Le QR code n'a pas été scanné par un téléphone réel** dans le cadre de ce prototype ;
  il l'a été par le décodeur système d'Apple. Un test caméra reste à faire sur site.
