import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { buildHtmlOutput, exampleHtml, formatHtml, minifyHtml, sanitizeEditableHtml } from './utils/html';
import './styles.css';

type SourceMatch = { start: number; end: number; status: string };
type RenderContext = { text: string; parentText: string; ratio: number };

const MAX_CONTEXT_LENGTH = 180;
const HIGHLIGHT_DURATION = 2200;
const IMAGE_FILE_PATTERN = /^image\/(png|jpeg|webp|gif)$/;
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i;
const FIGURE_WIDTH_CLASSES = ['figure-small', 'figure-medium', 'figure-large', 'figure-full'];
const IMAGE_UPLOAD_ENDPOINT = '/api/images';
const LOCAL_IMAGE_DIRECTORY = 'images';
const LOCAL_IMAGE_DB_NAME = 'edit-knowledge-images';
const LOCAL_IMAGE_STORE_NAME = 'images';
const localImagePreviewUrls = new Map<string, string>();
type FigureWidth = 'small' | 'medium' | 'large' | 'full';

function isSupportedImageFile(file: File): boolean {
  return IMAGE_FILE_PATTERN.test(file.type) || IMAGE_EXTENSION_PATTERN.test(file.name);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cleanImageName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'image';
}

function getImageExtension(file: File): string {
  const mimeExtension = file.type === 'image/jpeg' ? 'jpg' : file.type.replace('image/', '');
  const fileExtension = file.name.match(/\.(png|jpe?g|webp|gif)$/i)?.[1]?.toLowerCase().replace('jpeg', 'jpg');
  return ['png', 'jpg', 'webp', 'gif'].includes(mimeExtension) ? mimeExtension : fileExtension || 'png';
}

function createLocalImageReference(file: File): { previewSrc: string; outputSrc: string; fileName: string } {
  const fileName = `${cleanImageName(file.name)}-${Date.now().toString(36)}.${getImageExtension(file)}`;
  const outputSrc = `${LOCAL_IMAGE_DIRECTORY}/${fileName}`;
  const previewSrc = URL.createObjectURL(file);
  localImagePreviewUrls.set(outputSrc, previewSrc);
  return { previewSrc, outputSrc, fileName };
}

function openLocalImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOCAL_IMAGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ouverture du stockage image local impossible.'));
  });
}

async function storeLocalImage(outputSrc: string, file: File): Promise<void> {
  const database = await openLocalImageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_IMAGE_STORE_NAME, 'readwrite');
    transaction.objectStore(LOCAL_IMAGE_STORE_NAME).put(file, outputSrc);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Enregistrement local de l’image impossible.'));
  });
  database.close();
}

async function getLocalImagePreviewSrc(outputSrc: string): Promise<string | null> {
  const existingPreviewSrc = localImagePreviewUrls.get(outputSrc);
  if (existingPreviewSrc) return existingPreviewSrc;

  const database = await openLocalImageDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_IMAGE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(LOCAL_IMAGE_STORE_NAME).get(outputSrc);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('Lecture locale de l’image impossible.'));
  });
  database.close();
  if (!blob) return null;

  const previewSrc = URL.createObjectURL(blob);
  localImagePreviewUrls.set(outputSrc, previewSrc);
  return previewSrc;
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
  const [syncStatus, setSyncStatus] = useState('Synchronisation active');
  const [selectedFigureWidth, setSelectedFigureWidth] = useState<FigureWidth | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const sourceOverlayRef = useRef<HTMLPreElement>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const renderHighlightTimer = useRef<number | undefined>(undefined);
  const savedPreviewRange = useRef<Range | null>(null);
  const skipNextPreviewWrite = useRef(false);
  const htmlRef = useRef(html);
  const validation = useMemo(() => sanitizeEditableHtml(html), [html]);

  useEffect(() => {
    htmlRef.current = html;
  }, [html]);

  const highlightedSource = useMemo(() => {
    if (!sourceMatch) return escapeHtml(html);
    return `${escapeHtml(html.slice(0, sourceMatch.start))}<mark>${escapeHtml(html.slice(sourceMatch.start, sourceMatch.end))}</mark>${escapeHtml(html.slice(sourceMatch.end))}`;
  }, [html, sourceMatch]);

  const syncOverlayScroll = useCallback(() => {
    if (!sourceRef.current || !sourceOverlayRef.current) return;
    sourceOverlayRef.current.scrollTop = sourceRef.current.scrollTop;
    sourceOverlayRef.current.scrollLeft = 0;
  }, []);

  const revealSourceMatch = useCallback((match: SourceMatch) => {
    setSourceMatch(match);
    setPositionStatus(match.status);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setSourceMatch(null), HIGHLIGHT_DURATION);

    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      const overlay = sourceOverlayRef.current;
      if (!textarea) return;
      textarea.setSelectionRange(match.start, match.end);

      const highlightedMark = overlay?.querySelector('mark');
      if (highlightedMark instanceof HTMLElement) {
        textarea.scrollTop = Math.max(0, highlightedMark.offsetTop - textarea.clientHeight / 2);
      } else {
        const before = htmlRef.current.slice(0, match.start);
        const line = before.split('\n').length - 1;
        const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 22;
        textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 2);
      }
      textarea.scrollLeft = 0;
      syncOverlayScroll();
    });
  }, [syncOverlayScroll]);

  const syncFromPreviewSelection = useCallback(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument?.body) return;
    const context = getRenderContext(iframeDocument);
    if (!context) return;
    const match = findSourceMatch(htmlRef.current, context);
    if (match) revealSourceMatch(match);
    else setPositionStatus('Correspondance non trouvée dans le HTML source.');
  }, [revealSourceMatch]);


  const rememberPreviewSelection = useCallback(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    const selection = iframeDocument?.getSelection();
    if (!iframeDocument?.body || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    if (iframeDocument.body.contains(container.nodeType === Node.ELEMENT_NODE ? container as Element : container.parentElement)) {
      savedPreviewRange.current = range.cloneRange();
    }
  }, []);

  const getSelectedFigure = useCallback((): HTMLElement | null => {
    const iframeDocument = previewRef.current?.contentDocument;
    return iframeDocument?.querySelector<HTMLElement>('.article-figure.ek-selected-figure') ?? null;
  }, []);

  const selectFigure = useCallback((figure: HTMLElement | null) => {
    const iframeDocument = previewRef.current?.contentDocument;
    iframeDocument?.querySelectorAll('.article-figure.ek-selected-figure').forEach((node) => node.classList.remove('ek-selected-figure'));
    if (!figure) {
      setSelectedFigureWidth(null);
      return;
    }
    figure.classList.add('ek-selected-figure');
    const width = FIGURE_WIDTH_CLASSES.find((className) => figure.classList.contains(className))?.replace('figure-', '') as FigureWidth | undefined;
    setSelectedFigureWidth(width ?? 'medium');
  }, []);

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
    if (!iframeDocument?.body) return;

    const cleanBody = iframeDocument.body.cloneNode(true) as HTMLElement;
    cleanBody.querySelectorAll('.ek-render-position-highlight, .ek-selected-figure').forEach((node) => {
      node.classList.remove('ek-render-position-highlight', 'ek-selected-figure');
    });
    cleanBody.querySelectorAll<HTMLImageElement>('img[data-ek-src]').forEach((image) => {
      image.setAttribute('src', image.dataset.ekSrc ?? '');
      image.removeAttribute('data-ek-src');
    });

    const nextHtml = buildHtmlOutput({
      bodyHtml: cleanBody.innerHTML,
      bodyAttributes: validation.bodyAttributes,
      headHtml: validation.headHtml,
      isFullDocument: validation.isFullDocument,
    });

    skipNextPreviewWrite.current = true;
    setSourceMatch(null);
    setSyncStatus('Synchronisation active — dernière modification visuelle intégrée');
    setHtml(nextHtml);
  }, [validation.bodyAttributes, validation.headHtml, validation.isFullDocument]);


  const saveImageFile = async (file: File): Promise<{ previewSrc: string; outputSrc: string; persisted: boolean; fileName?: string }> => {
    const formData = new FormData();
    formData.append('image', file);
    try {
      const response = await fetch(IMAGE_UPLOAD_ENDPOINT, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await response.text() || 'Sauvegarde du fichier image impossible.');
      const payload = await response.json() as { src?: string };
      if (!payload.src || payload.src.startsWith('data:')) throw new Error('Le stockage image a renvoyé un chemin invalide.');
      return { previewSrc: payload.src, outputSrc: payload.src, persisted: true };
    } catch (error) {
      const localReference = createLocalImageReference(file);
      await storeLocalImage(localReference.outputSrc, file).catch((storageError) => {
        console.warn('Persistance IndexedDB indisponible, aperçu conservé pour la session courante uniquement.', storageError);
      });
      console.warn('Upload /api/images indisponible, insertion statique sans base64.', error);
      return { ...localReference, persisted: false };
    }
  };

  const insertImageFile = useCallback(async (file: File) => {
    if (!isSupportedImageFile(file)) {
      setSyncStatus('Insertion refusée — choisissez une image png, jpg, jpeg, webp ou gif');
      return;
    }
    const iframeDocument = previewRef.current?.contentDocument;
    if (!visualEditing || !iframeDocument?.body) return;
    let imageReference: Awaited<ReturnType<typeof saveImageFile>>;
    try {
      // Sauvegarde fichier : en dev/preview local, l’image est envoyée au middleware Vite,
      // qui écrit le fichier dans public/images. Sur un hébergement statique (GitHub Pages),
      // POST /api/images n’existe pas : on affiche alors un aperçu blob local, tandis que
      // le HTML final garde un chemin relatif images/nom.ext sans base64.
      imageReference = await saveImageFile(file);
    } catch (error) {
      setSyncStatus(error instanceof Error ? `Insertion refusée — ${error.message}` : 'Insertion refusée — sauvegarde image impossible');
      return;
    }
    iframeDocument.body.focus();
    const selection = iframeDocument.getSelection();
    selection?.removeAllRanges();
    if (savedPreviewRange.current) selection?.addRange(savedPreviewRange.current);
    else {
      const range = iframeDocument.createRange();
      range.selectNodeContents(iframeDocument.body);
      range.collapse(false);
      selection?.addRange(range);
    }

    const figure = iframeDocument.createElement('figure');
    figure.className = 'article-figure figure-medium';
    const image = iframeDocument.createElement('img');
    // Insertion HTML : seul le chemin relatif sauvegardé est écrit dans l’attribut src.
    // On utilise setAttribute pour éviter que le navigateur ne sérialise une URL absolue.
    image.setAttribute('src', imageReference.previewSrc);
    image.setAttribute('data-ek-src', imageReference.outputSrc);
    image.alt = '';
    const caption = iframeDocument.createElement('figcaption');
    caption.contentEditable = 'true';
    caption.textContent = 'Ajouter une légende…';
    figure.append(image, caption);

    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    range?.deleteContents();
    range?.insertNode(figure);
    const spacer = iframeDocument.createTextNode('\u00a0');
    figure.after(spacer);
    const nextRange = iframeDocument.createRange();
    nextRange.setStartAfter(spacer);
    nextRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
    savedPreviewRange.current = nextRange.cloneRange();
    selectFigure(figure);
    updateFromPreview();
    setSyncStatus(imageReference.persisted
      ? `Image enregistrée et insérée : ${imageReference.outputSrc}`
      : `Image insérée sans base64 : copiez aussi le fichier dans ${LOCAL_IMAGE_DIRECTORY}/${imageReference.fileName}`);
  }, [selectFigure, updateFromPreview, visualEditing]);

  const setFigureWidth = useCallback((width: FigureWidth) => {
    const figure = getSelectedFigure();
    if (!figure) return;
    figure.classList.remove(...FIGURE_WIDTH_CLASSES);
    figure.classList.add(`figure-${width}`);
    setSelectedFigureWidth(width);
    updateFromPreview();
  }, [getSelectedFigure, updateFromPreview]);

  const deleteSelectedFigure = useCallback(() => {
    const figure = getSelectedFigure();
    if (!figure) return;
    figure.remove();
    setSelectedFigureWidth(null);
    updateFromPreview();
  }, [getSelectedFigure, updateFromPreview]);

  useEffect(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument) return;

    if (skipNextPreviewWrite.current) {
      skipNextPreviewWrite.current = false;
      return;
    }

    iframeDocument.open();
    iframeDocument.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="${window.location.origin}${import.meta.env.BASE_URL}" target="_blank">
${validation.headHtml}
<style>
  html { background: transparent; scroll-behavior: smooth; }
  body { min-height: 100vh; margin: 0; outline: none; }
  body[contenteditable="true"] { cursor: text; }
  .ek-render-position-highlight { outline: 3px solid rgba(250, 204, 21, .9) !important; background-color: rgba(250, 204, 21, .22) !important; transition: outline-color .2s ease, background-color .2s ease; }
  .article-figure { margin: 1.4rem auto; max-width: 760px; width: min(100%, 760px); }
  .article-figure.figure-small { max-width: 360px; }
  .article-figure.figure-medium { max-width: 560px; }
  .article-figure.figure-large { max-width: 760px; }
  .article-figure.figure-full { max-width: 100%; width: 100%; }
  .article-figure img { border-radius: 12px; display: block; height: auto; margin: 0 auto; max-width: 100%; }
  .article-figure figcaption { color: #aab3c5; font-size: .9rem; line-height: 1.45; margin-top: .55rem; min-height: 1.3em; outline: none; text-align: center; }
  .article-figure figcaption:empty::before { content: 'Ajouter une légende…'; color: #7f8ba3; font-style: italic; }
  .article-figure.ek-selected-figure { outline: 2px solid rgba(96, 165, 250, .78); outline-offset: 8px; border-radius: 14px; }
</style>
</head>
<body${validation.bodyAttributes ? ` ${validation.bodyAttributes}` : ''} contenteditable="${visualEditing ? 'true' : 'false'}">${validation.bodyHtml}</body>
</html>`);
    iframeDocument.close();

    iframeDocument.querySelectorAll<HTMLImageElement>(`img[src^="${LOCAL_IMAGE_DIRECTORY}/"]`).forEach((image) => {
      const outputSrc = image.getAttribute('src');
      if (!outputSrc) return;
      void getLocalImagePreviewSrc(outputSrc).then((previewSrc) => {
        if (!previewSrc || !iframeDocument.body.contains(image)) return;
        image.setAttribute('data-ek-src', outputSrc);
        image.setAttribute('src', previewSrc);
      }).catch((error) => {
        console.warn('Aperçu local introuvable pour l’image insérée.', error);
      });
    });

    const handleInput = () => updateFromPreview();
    const handlePointerOrSelection = (event?: Event) => {
      rememberPreviewSelection();
      if (event?.type !== 'selectionchange') {
        const target = event?.target instanceof Element ? event.target : null;
        selectFigure(target?.closest<HTMLElement>('.article-figure') ?? null);
      }
      window.setTimeout(syncFromPreviewSelection, 0);
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (!visualEditing) return;
      event.preventDefault();
      const imageFile = [...(event.clipboardData?.files ?? [])].find(isSupportedImageFile);
      if (imageFile) {
        void insertImageFile(imageFile);
        return;
      }
      iframeDocument.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      updateFromPreview();
    };

    iframeDocument.body.addEventListener('input', handleInput);
    iframeDocument.body.addEventListener('blur', handleInput);
    iframeDocument.body.addEventListener('click', handlePointerOrSelection);
    iframeDocument.body.addEventListener('keyup', handlePointerOrSelection);
    iframeDocument.addEventListener('selectionchange', handlePointerOrSelection);
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && getSelectedFigure()) {
        event.preventDefault();
        deleteSelectedFigure();
      }
    };
    iframeDocument.body.addEventListener('paste', handlePaste);
    iframeDocument.body.addEventListener('keydown', handleKeyDown);

    return () => {
      if (skipNextPreviewWrite.current) return;
      iframeDocument.body?.removeEventListener('input', handleInput);
      iframeDocument.body?.removeEventListener('blur', handleInput);
      iframeDocument.body?.removeEventListener('click', handlePointerOrSelection);
      iframeDocument.body?.removeEventListener('keyup', handlePointerOrSelection);
      iframeDocument.removeEventListener('selectionchange', handlePointerOrSelection);
      iframeDocument.body?.removeEventListener('paste', handlePaste);
      iframeDocument.body?.removeEventListener('keydown', handleKeyDown);
    };
  }, [deleteSelectedFigure, getSelectedFigure, insertImageFile, rememberPreviewSelection, selectFigure, syncFromPreviewSelection, updateFromPreview, validation.bodyAttributes, validation.bodyHtml, validation.headHtml, visualEditing]);


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
        onInsertImage={insertImageFile}
        selectedFigureWidth={selectedFigureWidth}
        onSetFigureWidth={setFigureWidth}
        onDeleteFigure={deleteSelectedFigure}
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
              wrap="soft"
              onChange={(e) => { setHtml(e.target.value); setSourceMatch(null); setSyncStatus('Synchronisation active — source HTML modifiée'); }}
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
          <div className="sync-indicator" role="status">{syncStatus}</div>
          <div className="reader-frame">
            <iframe ref={previewRef} className="editable-document-frame" title="Rendu HTML éditable isolé" sandbox="allow-same-origin" />
          </div>
        </section>
      </main>
      <footer className="notes">
        <strong>Repérage :</strong> {positionStatus} <strong>Synchronisation :</strong> {syncStatus}. <strong>Limites :</strong> l’édition visuelle conserve les balises, styles et classes existants tant que les changements restent textuels ou structurels simples. Les mises en page très complexes, scripts et attributs événementiels sont neutralisés pour limiter les risques côté rendu local.
      </footer>
    </div>
  );
}
