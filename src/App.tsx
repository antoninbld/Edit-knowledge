import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { buildHtmlOutput, exampleHtml, formatHtml, minifyHtml, sanitizeEditableHtml } from './utils/html';
import './styles.css';

export default function App() {
  const [html, setHtml] = useState(exampleHtml);
  const [visualEditing, setVisualEditing] = useState(true);
  const [leftWidth, setLeftWidth] = useState(48);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const isVisualSync = useRef(false);
  const validation = useMemo(() => sanitizeEditableHtml(html), [html]);

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
  html { background: transparent; }
  body { min-height: 100vh; margin: 0; outline: none; }
  body[contenteditable="true"] { cursor: text; }
</style>
</head>
<body${validation.bodyAttributes ? ` ${validation.bodyAttributes}` : ''} contenteditable="${visualEditing ? 'true' : 'false'}">${validation.bodyHtml}</body>
</html>`);
    iframeDocument.close();

    const handleInput = () => updateFromPreview();
    const handlePaste = (event: ClipboardEvent) => {
      if (!visualEditing) return;
      event.preventDefault();
      iframeDocument.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      updateFromPreview();
    };

    iframeDocument.body.addEventListener('input', handleInput);
    iframeDocument.body.addEventListener('blur', handleInput);
    iframeDocument.body.addEventListener('paste', handlePaste);

    return () => {
      iframeDocument.body?.removeEventListener('input', handleInput);
      iframeDocument.body?.removeEventListener('blur', handleInput);
      iframeDocument.body?.removeEventListener('paste', handlePaste);
    };
  }, [validation.bodyAttributes, validation.bodyHtml, validation.headHtml, visualEditing, updateFromPreview]);

  useEffect(() => {
    const iframeDocument = previewRef.current?.contentDocument;
    if (!iframeDocument?.body) return;
    iframeDocument.body.contentEditable = String(visualEditing);
  }, [visualEditing]);

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
          <textarea value={html} spellCheck={false} onChange={(e) => setHtml(e.target.value)} aria-label="Code HTML source" />
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
        <strong>Limites :</strong> l’édition visuelle conserve les balises, styles et classes existants tant que les changements restent textuels ou structurels simples. Les mises en page très complexes, scripts et attributs événementiels sont neutralisés pour limiter les risques côté rendu local.
      </footer>
    </div>
  );
}
