# Audit — Mise en forme des emails, signature et assignation dans le tableau (2026-11-13)

## Périmètre

- **Message des emails mis en forme** : éditeur (Nuxt UI `UEditor`, TipTap) avec gras, italique, souligné, couleur du texte, surlignage, listes et effacement de la mise en forme. Seule nouvelle dépendance : `@tiptap/extension-text-style` 3.32.2, même version que le reste de TipTap déjà embarqué par Nuxt UI.
- **Signature** : propre à chaque administrateur. Elle est saisie dans la fenêtre d'envoi, pré-remplie avec la dernière enregistrée, enregistrée à l'envoi puis ajoutée en fin d'email.
  - Stockage : colonne `users.email_signature` (migration `0004_email_signature`), non touchée par la synchronisation de l'annuaire.
  - Lecture : `GET /api/admin/me/signature`, réservée aux admins, qui ne renvoie que la signature de l'admin connecté.
- **Assignation directe dans le tableau** :
  - colonne Valideur : clic, puis recherche dans l'annuaire à partir de 2 lettres et choix, sans cocher ni valider ;
  - clic sur l'auteur du partage : retrouvé dans l'annuaire par son adresse exacte (email ou identifiant) puis assigné. Un message s'affiche s'il n'est pas dans l'annuaire ;
  - clic sur le N+1 suggéré : assigné directement ;
  - si la ligne fait partie des lignes cochées, le choix s'applique à toutes les lignes cochées.

## Revue de sécurité

- **XSS ou injection HTML dans les emails** :
  - le message et la signature circulent en **JSON de l'éditeur, jamais en HTML**. Le serveur valide le document (Zod : racine `doc`, 5 000 caractères, profondeur 8 contrôlée sans récursion avant la validation), puis produit lui-même le HTML (`shared/richText.ts`) ;
  - liste fermée : paragraphes, listes, retours à la ligne, gras, italique, souligné, barré, couleur, fond. Tout autre nœud (image, iframe…) est réduit à son texte ;
  - texte et attributs échappés ; couleurs limitées aux formats `#hex` ou `rgb()` (pas d'`url()` ni d'expression) ; liens limités à `http(s):` et `mailto:`.
  - Tests unitaires `tests/unit/rich-text.test.ts`. Un HTML envoyé à la place du document est refusé (test d'intégration).
- **Aperçu côté navigateur** : composant `RichText` rendu par fonctions `h()`, **sans `v-html`**, avec les mêmes règles de filtrage que l'email.
- **CSP** : les pastilles de couleur sont des images `data:` (déjà autorisées par `img-src`). Aucune modification de la CSP.
- **Autorisation et IDOR** :
  - la signature est lue et écrite uniquement pour l'admin connecté (identifiant pris dans la session, jamais dans la requête) ;
  - l'assignation dans le tableau réutilise la route d'assignation existante, réservée à l'admin, qui revérifie le statut des lignes et le compte du valideur.
- **Données** : la recherche dans l'annuaire renvoie en plus l'identifiant de connexion (UPN), aux seuls admins, pour rapprocher l'auteur d'un partage.
- **Traçabilité** : l'audit `notification.send` indique si la signature a été saisie (`signatureUpdated`). Les assignations restent tracées par `item.assign`.
- **`npm audit --omit=dev`** : 14 vulnérabilités (2 faibles, 12 modérées), inchangé.

Aucun constat ouvert.

## Limites

- Le logo de la signature (image) n'est pas repris : les images sont exclues du message, car leur envoi demanderait des pièces jointes intégrées.

## TNR

- `npm run typecheck` : OK.
- `npm run test` : 100/100 (nouveaux tests : rendu et filtrage du texte mis en forme, imbrication extrême, signature enregistrée, réutilisée puis effacée).
- `npm run test:e2e` : 24/24 (nouveaux tests : gras et signature dans l'aperçu, valideur choisi dans la colonne Valideur, clic sur un auteur absent de l'annuaire).

## Complément : corps unique et nouvelle page de connexion

- **Email** :
  - un seul corps de message, pré-rempli avec le message et la signature de David DOUILLARD, modifiable à volonté. Plus de champ « Signature » séparé, plus d'aperçu ;
  - suppression de la signature enregistrée par administrateur (route `GET /api/admin/me/signature` retirée, colonne supprimée par la migration `0005_drop_email_signature`) ;
  - le corps reste validé puis converti en HTML par le serveur selon les mêmes règles (liste fermée de styles, texte échappé).
- **Page de connexion** :
  - deux panneaux : présentation « CTRL IT » avec le logo du groupe Fimavi, et bouton « Se connecter avec Microsoft » avec le logo Microsoft (SVG local) ;
  - le lien pointe toujours vers `/auth/microsoft` (flux OIDC inchangé) ;
  - logo Fimavi (`public/logo-fimavi.png`, extrait de la signature email) affiché aussi en haut à gauche de l'en-tête une fois connecté ;
  - aucune ressource externe, CSP inchangée.
- **TNR** : `npm run typecheck` OK, `npm run test` 100/100, `npm run test:e2e` 24/24.
- **Note** : la signature par défaut contient le nom, le téléphone et l'adresse email de David DOUILLARD, à sa demande. Les autres administrateurs la remplacent dans le corps avant l'envoi.

## Complément : bannière de signature et salutation dans le corps

- **Salutation et champs** : le corps commence par `Bonjour [Prénom Nom],` puis `[Vérifications en attente]`. À l'envoi, ces champs sont remplacés pour chaque destinataire : nom échappé ; phrase du nombre de lignes et lien vers l'application, produits par le serveur. Si l'admin retire `[Vérifications en attente]`, la phrase et le lien sont ajoutés en tête : le lien est toujours présent.
- **Bannière Fimavi** (image de la signature d'origine) :
  - affichée dans l'éditeur depuis `public/signature-fimavi.jpg` ; un bouton de la barre d'outils permet de la réinsérer ;
  - envoyée en **pièce jointe intégrée** (`cid:signature-fimavi`, Graph `fileAttachment` avec `isInline`), affichée par Outlook sans téléchargement externe.
- **Sécurité** :
  - **liste fermée** d'images (`INLINE_IMAGES`, contenu embarqué dans le serveur, `server/utils/inlineImages.ts`) ;
  - toute autre image du document (URL externe, `data:`) est ignorée à l'envoi, et les images collées en base64 sont refusées par l'éditeur ;
  - aucun HTML saisi n'est accepté : « mode HTML » s'entend comme un email HTML produit par le serveur, pas comme une saisie de HTML brut, qui ouvrirait une injection dans les emails envoyés depuis helpdesk.
  - Tests : champs remplacés et échappés, lien non dupliqué, image jointe, images étrangères ignorées.
- **TNR** : `npm run typecheck` OK, `npm run test` 102/102, `npm run test:e2e` 24/24. `npm audit --omit=dev` : inchangé.
