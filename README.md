# Éditeur local de fiches HTML

Application React + TypeScript pour éditer localement des fiches HTML en vue scindée : source à gauche, rendu visuel éditable à droite.

## Lancer le projet

```bash
npm install
npm run dev
```

Build de production :

```bash
npm run build
npm run preview
```

## Fonctionnalités

- collage d'un exemple de fiche HTML ;
- chargement d'un fichier `.html` ou `.htm` ;
- édition bidirectionnelle entre le HTML source et le rendu `contentEditable` ;
- repérage de position entre le rendu et le code : un clic dans la fiche fait défiler le HTML source vers le mot ou fragment correspondant et le surligne en jaune ;
- repérage inverse léger : un clic dans le code tente de retrouver le texte visible correspondant dans l’iframe et met brièvement en évidence son élément parent ;
- redimensionnement horizontal des deux panneaux ;
- formatage et minification simples du HTML ;
- copie et téléchargement du HTML final ;
- commandes visuelles de base : gras, italique, listes, lien ;
- rendu sécurisé de façon minimale : suppression des scripts, iframes, objets embarqués, attributs `on*` et URLs `javascript:`.


## Insertion d'images sans base64

Le bouton **Insérer une image** n'écrit jamais de base64 dans le HTML final.

- En `npm run dev` et en `npm run preview`, Vite expose `POST /api/images` via un middleware local. L'image est copiée dans `public/images`, puis le HTML référence un chemin relatif `images/nom.ext`.
- Sur un hébergement statique comme GitHub Pages, aucune route backend ne peut recevoir `POST /api/images` ni écrire dans `public/images` au runtime. L'application insère donc un aperçu local `blob:` dans l'iframe, mémorise le fichier dans IndexedDB pour pouvoir relire le même HTML dans le navigateur, mais garde dans le HTML final un `src="images/nom.ext"`. Pour publier la fiche ou l'ouvrir dans un autre navigateur, copiez aussi le fichier image correspondant dans un dossier `images` placé à côté du HTML exporté.

Architecture recommandée si l'écriture automatique d'images doit fonctionner aussi en ligne : déployer une vraie API d'upload (Node/Express, serverless function ou stockage objet type S3/R2/Supabase Storage), puis faire renvoyer à l'éditeur l'URL publique ou le chemin relatif à écrire dans le HTML.

## Synchronisation de position

La zone de code reste une `textarea` native pour conserver une interface légère, compatible avec GitHub Pages et sans dépendance lourde. Pour permettre le surlignage d’un fragment précis, l’application ajoute un calque `<pre>` synchronisé derrière la `textarea` : le texte de la `textarea` reste éditable, tandis que le calque affiche le même contenu avec un `<mark>` jaune sur la correspondance trouvée.

Dans le sens rendu visuel → source, les clics, déplacements de curseur et changements de sélection dans l’iframe extraient le mot courant, le texte sélectionné ou un contexte court du parent. L’application recherche ensuite ce fragment dans le HTML source en tolérant les différences d’accents, de casse, d’espaces et de retours à la ligne, puis choisit l’occurrence la plus proche de la position approximative dans le document.

Dans le sens source → rendu, un clic ou déplacement de curseur dans le code extrait le mot visible le plus proche. Les fragments techniques sans équivalent visible, comme les balises, styles, métadonnées ou attributs, sont ignorés lorsqu’aucun texte affichable ne peut être identifié. Si une correspondance existe dans l’iframe, son élément parent est centré et brièvement encadré en jaune.

Limite : lorsque le même mot apparaît plusieurs fois avec un contexte très proche, l’application choisit la correspondance la plus probable grâce au contexte et à la position approximative, mais une ambiguïté reste possible.

## Architecture

- `src/App.tsx` orchestre l'état HTML, la synchronisation bidirectionnelle, le chargement, la copie et le téléchargement.
- `src/components/Toolbar.tsx` regroupe les actions de l'interface et les commandes d'édition.
- `src/utils/html.ts` contient l'exemple, la sanitisation minimale, le formatage et la minification.
- `src/styles.css` définit l'interface sombre, les panneaux redimensionnables et la zone de lecture confortable.

## Limites connues

Cette application privilégie un compromis robuste et local plutôt qu'un éditeur WYSIWYG parfait. L'édition visuelle repose sur `contentEditable` : elle préserve bien les balises et classes existantes pour des modifications textuelles, titres, paragraphes, listes et liens simples, mais le navigateur peut normaliser certains fragments HTML. Les scripts et attributs événementiels sont retirés du rendu éditable pour éviter les exécutions involontaires. Les mises en page complexes, composants interactifs, formulaires avancés ou styles dépendants de JavaScript ne sont pas garantis.

## Améliorations possibles

- intégrer ProseMirror/Tiptap avec un schéma HTML personnalisé ;
- ajouter un diff visuel avant d'écraser le HTML source ;
- conserver séparément le document complet (`head`, styles embarqués, body) ;
- ajouter une recherche dans les longues fiches ;
- proposer une palette de commandes sémantiques pour transformer paragraphes, citations et blocs.
