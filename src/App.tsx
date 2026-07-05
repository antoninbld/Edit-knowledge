import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { buildHtmlOutput, exampleHtml, formatHtml, minifyHtml, sanitizeEditableHtml } from './utils/html';
import './styles.css';

type SourceMatch = { start: number; end: number; status: string };
type RenderContext = { text: string; parentText: string; ratio: number };

const MAX_CONTEXT_LENGTH = 180;
const HIGHLIGHT_DURATION = 2200;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getWordAt(text: string, offset: number): string {
  const left = text.slice(0, offset).search(/[\p{L}\p{N}'’_-]+$/u);
  const start = left === -1 ? offset : left;
  const right = text.slice(offset).match(/^[\p{L}\p{N}'’_-]+/u)?.[0].length ?? 0;
  return text.slice(start, offset + right).trim();
}

function extractSourceToken(source: string, cursor: number): string {
  const previousTagStart = source.lastIndexOf('<', cursor);
  const previousTagEnd = source.lastIndexOf('>', cursor);
  if (previousTagStart > previousTagEnd) return '';

  const nearby = getWordAt(source, cursor);
  if (nearby && !/^\/?[a-z][\w:-]*$/i.test(nearby)) return nearby;

  const before = source.lastIndexOf('>', cursor);
  const after = source.indexOf('<', cursor);
  if (before !== -1 && after !== -1 && after > before) {
    return getWordAt(source.slice(before + 1, after), Math.max(0, cursor - before - 1));
  }
  return '';
}

function findSourceMatch(source: string, context: RenderContext): SourceMatch | null {
  const candidates = [context.text, ...context.parentText.split(/\s+/).filter((part) => part.length > context.text.length).slice(0, 4)]
    .map((part) => part.trim())
    .filter((part, index, parts) => part.length >= 2 && parts.indexOf(part) === index);

  const approximateIndex = Math.round(source.length * context.ratio);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const matches: SourceMatch[] = [];
    const pattern = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const exactRegex = new RegExp(pattern, 'giu');
    let exactMatch: RegExpExecArray | null;
    while ((exactMatch = exactRegex.exec(source))) {
      matches.push({ start: exactMatch.index, end: exactMatch.index + exactMatch[0].length, status: `Correspondance trouvée : « ${candidate} »` });
    }

    if (!matches.length) {
      const normalizedSource = normalizeText(source);
      const normalizedIndex = normalizedSource.indexOf(normalizedCandidate);
      if (normalizedIndex >= 0) {
        const rawIndex = source.toLowerCase().indexOf(candidate.toLowerCase()[0] ?? '', Math.max(0, normalizedIndex - 20));
        if (rawIndex >= 0) matches.push({ start: rawIndex, end: Math.min(source.length, rawIndex + candidate.length), status: `Correspondance approximative : « ${candidate} »` });
      }
    }

    if (matches.length) {
      return matches.sort((a, b) => Math.abs(a.start - approximateIndex) - Math.abs(b.start - approximateIndex))[0];
    }
  }
  return null;
}

function getRenderContext(document: Document): RenderContext | null {
  const selection = document.getSelection();
  const focusNode = selection?.focusNode;
  if (!focusNode) return null;

  const nodeText = focusNode.textContent ?? '';
  const offset = selection?.focusOffset ?? 0;
  const selectedText = selection && !selection.isCollapsed ? selection.toString().trim() : '';
  const word = selectedText || getWordAt(nodeText, offset);
  const element = focusNode.nodeType === Node.ELEMENT_NODE ? focusNode as Element : focusNode.parentElement;
  const parentText = (element?.textContent ?? nodeText).replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT_LENGTH);
  const bodyText = document.body.innerText || document.body.textContent || '';
  const absoluteTextIndex = Math.max(0, bodyText.indexOf(word || parentText));
  const ratio = bodyText.length ? absoluteTextIndex / bodyText.length : 0;

  if (!word && !parentText) return null;
  return { text: word || parentText, parentText, ratio };
}

function findTextElement(document: Document, token: string): HTMLElement | null {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) return null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (normalizeText(node.textContent ?? '').includes(normalizedToken)) {
      return node.parentElement;
    }
    node = walker.nextNode();
  }
  return null;
}

export default function App() {
  const [html, setHtml] = useState(exampleHtml);
  const [visualEditing, setVisualEditing] = useState(true);
  const [leftWidth, setLeftWidth] = useState(48);
  const [sourceMatch, setSourceMatch] = useState<SourceMatch | null>(null);
  const [positionStatus, setPositionStatus] = useState('Cliquez dans le rendu ou le code pour synchroniser la position.');
  const previewRef = useRef<HTMLIFrameElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const sourceOverlayRef = useRef<HTMLPreElement>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const renderHighlightTimer = useRef<number | undefined>(undefined);
  const isVisualSync = useRef(false);
  const validation = useMemo(() => sanitizeEditableHtml(html), [html]);

  const highlightedSource = useMemo(() => {
    if (!sourceMatch) return escapeHtml(html);
    return `${escapeHtml(html.slice(0, sourceMatch.start))}<mark>${escapeHtml(html.slice(sourceMatch.start, sourceMatch.end))}</mark>${escapeHtml(html.slice(sourceMatch.end))}`;
  }, [html, sourceMatch]);

  const syncOverlayScroll = useCallback(() => {
    if (!sourceRef.current || !sourceOverlayRef.current) return;
    sourceOverlayRef.current.scrollTop = sourceRef.current.scrollTop;
    sourceOverlayRef.current.scrollLeft = sourceRef.current.scrollLeft;
  }, []);

  const revealSourceMatch = useCallback((match: SourceMatch) => {
    setSourceMatch(match);
    setPositionStatus(match.status);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setSourceMatch(null), HIGHLIGHT_DURATION);

    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.setSelectionRange(match.start, match.end);
      const before = html.slice(0, match.start);
      const line = before.split('\n').length - 1;
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 22;
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 2);
      syncOverlayScroll();
    });
  }, [html, syncOverlayScroll]);

  const syncFromPreviewSelection = useCallback(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument?.body) return;
    const context = getRenderContext(iframeDocument);
    if (!context) return;
    const match = findSourceMatch(html, context);
    if (match) revealSourceMatch(match);
    else setPositionStatus('Correspondance non trouvée dans le HTML source.');
  }, [html, revealSourceMatch]);

  const syncPreviewFromSource = useCallback((cursor: number) => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument?.body) return;
    const token = extractSourceToken(html, cursor);
    if (!token) return;
    const element = findTextElement(iframeDocument, token);
    if (!element) {
      setPositionStatus('Aucun contenu visible correspondant dans le rendu.');
      return;
    }
    iframeDocument.querySelectorAll('.ek-render-position-highlight').forEach((node) => node.classList.remove('ek-render-position-highlight'));
    element.classList.add('ek-render-position-highlight');
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setPositionStatus(`Rendu positionné sur : « ${token} »`);
    window.clearTimeout(renderHighlightTimer.current);
    renderHighlightTimer.current = window.setTimeout(() => element.classList.remove('ek-render-position-highlight'), HIGHLIGHT_DURATION);
  }, [html]);

  const updateFromPreview = useCallback(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument) return;

    isVisualSync.current = true;
    setHtml(buildHtmlOutput({
      bodyHtml: iframeDocument.body.innerHTML,
      bodyAttributes: validation.bodyAttributes,
      headHtml: validation.headHtml,
      isFullDocument: validation.isFullDocument,
    }));
    window.setTimeout(() => { isVisualSync.current = false; }, 0);
  }, [validation.bodyAttributes, validation.headHtml, validation.isFullDocument]);

  useEffect(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument || isVisualSync.current) return;

    iframeDocument.open();
    iframeDocument.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base target="_blank">
${validation.headHtml}
<style>
  html { background: transparent; scroll-behavior: smooth; }
  body { min-height: 100vh; margin: 0; outline: none; }
  body[contenteditable="true"] { cursor: text; }
  .ek-render-position-highlight { outline: 3px solid rgba(250, 204, 21, .9) !important; background-color: rgba(250, 204, 21, .22) !important; transition: outline-color .2s ease, background-color .2s ease; }
</style>
</head>
<body${validation.bodyAttributes ? ` ${validation.bodyAttributes}` : ''} contenteditable="${visualEditing ? 'true' : 'false'}">${validation.bodyHtml}</body>
</html>`);
    iframeDocument.close();

    const handleInput = () => updateFromPreview();
    const handlePointerOrSelection = () => window.setTimeout(syncFromPreviewSelection, 0);
    const handlePaste = (event: ClipboardEvent) => {
      if (!visualEditing) return;
      event.preventDefault();
      iframeDocument.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      updateFromPreview();
    };

    iframeDocument.body.addEventListener('input', handleInput);
    iframeDocument.body.addEventListener('blur', handleInput);
    iframeDocument.body.addEventListener('click', handlePointerOrSelection);
    iframeDocument.body.addEventListener('keyup', handlePointerOrSelection);
    iframeDocument.addEventListener('selectionchange', handlePointerOrSelection);
    iframeDocument.body.addEventListener('paste', handlePaste);

    return () => {
      iframeDocument.body?.removeEventListener('input', handleInput);
      iframeDocument.body?.removeEventListener('blur', handleInput);
      iframeDocument.body?.removeEventListener('click', handlePointerOrSelection);
      iframeDocument.body?.removeEventListener('keyup', handlePointerOrSelection);
      iframeDocument.removeEventListener('selectionchange', handlePointerOrSelection);
      iframeDocument.body?.removeEventListener('paste', handlePaste);
    };
  }, [validation.bodyAttributes, validation.bodyHtml, validation.headHtml, visualEditing, updateFromPreview, syncFromPreviewSelection]);

  useEffect(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument?.body) return;
    iframeDocument.body.contentEditable = String(visualEditing);
  }, [visualEditing]);

  useEffect(() => () => {
    window.clearTimeout(highlightTimer.current);
    window.clearTimeout(renderHighlightTimer.current);
  }, []);

  const loadFile = async (file: File) => setHtml(await file.text());

  const copyHtml = async () => {
    await navigator.clipboard.writeText(sanitizeEditableHtml(html).safeHtml);
  };

  const downloadHtml = () => {
    const blob = new Blob([sanitizeEditableHtml(html).safeHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'fiche-editee.html';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runCommand = (command: string, value?: string) => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!visualEditing || !iframeDocument?.body) return;
    iframeDocument.body.focus();
    iframeDocument.execCommand(command, false, value);
    updateFromPreview();
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = leftWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = ((moveEvent.clientX - startX) / window.innerWidth) * 100;
      setLeftWidth(Math.min(72, Math.max(28, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="app-shell">
      <Toolbar
        visualEditing={visualEditing}
        onToggleVisualEditing={() => setVisualEditing((value) => !value)}
        onPasteExample={() => setHtml(exampleHtml)}
        onLoadFile={loadFile}
        onCopy={copyHtml}
        onDownload={downloadHtml}
        onReset={() => setHtml('')}
        onFormat={() => setHtml(formatHtml(html))}
        onMinify={() => setHtml(minifyHtml(html))}
        onCommand={runCommand}
      />
      <main className="workspace">
        <section className="pane code-pane" style={{ flexBasis: `${leftWidth}%` }}>
          <div className="pane-header"><strong>HTML source</strong><span>{html.length.toLocaleString('fr-FR')} caractères</span></div>
          <div className="source-editor-shell">
            <pre ref={sourceOverlayRef} className="source-highlight-overlay" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightedSource }} />
            <textarea
              ref={sourceRef}
              value={html}
              spellCheck={false}
              onChange={(e) => { setHtml(e.target.value); setSourceMatch(null); }}
              onClick={(e) => syncPreviewFromSource(e.currentTarget.selectionStart)}
              onKeyUp={(e) => syncPreviewFromSource(e.currentTarget.selectionStart)}
              onScroll={syncOverlayScroll}
              aria-label="Code HTML source"
            />
          </div>
        </section>
        <div className="resize-handle" onPointerDown={startResize} title="Redimensionner" />
        <section className="pane visual-pane" style={{ flexBasis: `${100 - leftWidth}%` }}>
          <div className="pane-header"><strong>Rendu éditable isolé</strong><span className={`status ${validation.status}`}>{validation.message}</span></div>
          <div className="reader-frame">
            <iframe ref={previewRef} className="editable-document-frame" title="Rendu HTML éditable isolé" sandbox="allow-same-origin" />
          </div>
        </section>
      </main>
      <footer className="notes">
        <strong>Repérage :</strong> {positionStatus} <strong>Limites :</strong> l’édition visuelle conserve les balises, styles et classes existants tant que les changements restent textuels ou structurels simples. Les mises en page très complexes, scripts et attributs événementiels sont neutralisés pour limiter les risques côté rendu local.
      </footer>
    </div>
  );
}
