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
- redimensionnement horizontal des deux panneaux ;
- formatage et minification simples du HTML ;
- copie et téléchargement du HTML final ;
- commandes visuelles de base : gras, italique, listes, lien ;
- rendu sécurisé de façon minimale : suppression des scripts, iframes, objets embarqués, attributs `on*` et URLs `javascript:`.

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
