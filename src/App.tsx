import { useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { exampleHtml, formatHtml, minifyHtml, sanitizeEditableHtml } from './utils/html';
import './styles.css';

export default function App() {
  const [html, setHtml] = useState(exampleHtml);
  const [visualEditing, setVisualEditing] = useState(true);
  const [leftWidth, setLeftWidth] = useState(48);
  const previewRef = useRef<HTMLDivElement>(null);
  const isVisualSync = useRef(false);
  const validation = useMemo(() => sanitizeEditableHtml(html), [html]);

  useEffect(() => {
    if (!previewRef.current || isVisualSync.current) return;
    if (previewRef.current.innerHTML !== validation.safeHtml) previewRef.current.innerHTML = validation.safeHtml;
  }, [validation.safeHtml]);

  const updateFromPreview = () => {
    if (!previewRef.current) return;
    isVisualSync.current = true;
    setHtml(previewRef.current.innerHTML);
    window.setTimeout(() => { isVisualSync.current = false; }, 0);
  };

  const loadFile = async (file: File) => setHtml(await file.text());

  const copyHtml = async () => {
    await navigator.clipboard.writeText(html);
  };

  const downloadHtml = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'fiche-editee.html';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runCommand = (command: string, value?: string) => {
    if (!visualEditing || !previewRef.current) return;
    previewRef.current.focus();
    document.execCommand(command, false, value);
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
          <div className="pane-header"><strong>Rendu éditable</strong><span className={`status ${validation.status}`}>{validation.message}</span></div>
          <div className="reader-frame">
            <div
              ref={previewRef}
              className="editable-document"
              contentEditable={visualEditing}
              suppressContentEditableWarning
              onInput={updateFromPreview}
              onBlur={updateFromPreview}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
                updateFromPreview();
              }}
            />
          </div>
        </section>
      </main>
      <footer className="notes">
        <strong>Limites :</strong> l’édition visuelle conserve les balises et classes existantes tant que les changements restent textuels ou structurels simples. Les mises en page très complexes, scripts et attributs événementiels sont neutralisés pour limiter les risques côté rendu local.
      </footer>
    </div>
  );
}
