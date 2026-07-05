export const exampleHtml = `<article class="fiche connaissance" data-topic="édition-html">
  <header class="fiche-header">
    <p class="eyebrow">Fiche pratique</p>
    <h1>Créer une routine de révision efficace</h1>
    <p class="lead">Une bonne fiche doit rester lisible, structurée et facile à mettre à jour.</p>
  </header>

  <section class="bloc essentiel">
    <h2>Idée principale</h2>
    <p>Réviser souvent sur des sessions courtes améliore la mémorisation à long terme.</p>
    <ul>
      <li>Relire la fiche rapidement après création.</li>
      <li>Programmer une deuxième lecture sous 48 heures.</li>
      <li>Transformer les points clés en questions.</li>
    </ul>
  </section>

  <section class="bloc note">
    <h2>À retenir</h2>
    <p>Le plus important est de garder une fiche <strong>simple</strong>, <em>actionnable</em> et liée à des exemples concrets.</p>
    <p>Source utile : <a href="https://fr.wikipedia.org/wiki/R%C3%A9p%C3%A9tition_espac%C3%A9e">répétition espacée</a>.</p>
  </section>
</article>`;

const parser = new DOMParser();

export type HtmlValidation = {
  safeHtml: string;
  status: 'synchronized' | 'warning';
  message: string;
};

export function sanitizeEditableHtml(input: string): HtmlValidation {
  try {
    const document = parser.parseFromString(input, 'text/html');
    const parserError = document.querySelector('parsererror');

    document.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => node.remove());
    document.querySelectorAll<HTMLElement>('*').forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on')) element.removeAttribute(attribute.name);
        if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
          element.removeAttribute(attribute.name);
        }
      });
    });

    return {
      safeHtml: document.body.innerHTML,
      status: parserError ? 'warning' : 'synchronized',
      message: parserError
        ? 'HTML partiellement invalide : rendu dégradé généré par le navigateur.'
        : 'Synchronisé',
    };
  } catch (error) {
    return {
      safeHtml: '',
      status: 'warning',
      message: error instanceof Error ? error.message : 'Erreur inconnue pendant le rendu HTML.',
    };
  }
}

export function formatHtml(input: string): string {
  const normalized = sanitizeEditableHtml(input).safeHtml;
  let indent = 0;
  return normalized
    .replace(/></g, '>\n<')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^<\/[^>]+>/.test(line)) indent = Math.max(indent - 1, 0);
      const padded = `${'  '.repeat(indent)}${line}`;
      if (/^<[^/!][^>]*[^/]>(?!.*<\/)/.test(line) && !isVoidElementLine(line)) indent += 1;
      return padded;
    })
    .join('\n');
}

export function minifyHtml(input: string): string {
  return sanitizeEditableHtml(input).safeHtml.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').trim();
}

function isVoidElementLine(line: string): boolean {
  return /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(line);
}
