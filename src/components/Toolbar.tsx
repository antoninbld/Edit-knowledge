type Props = {
  visualEditing: boolean;
  onToggleVisualEditing: () => void;
  onPasteExample: () => void;
  onLoadFile: (file: File) => void;
  onCopy: () => void;
  onDownload: () => void;
  onReset: () => void;
  onFormat: () => void;
  onMinify: () => void;
  onCommand: (command: string, value?: string) => void;
};

export function Toolbar(props: Props) {
  return (
    <header className="toolbar">
      <div className="brand"><span>⌘</span> Éditeur local HTML</div>
      <button onClick={props.onPasteExample}>Coller un exemple</button>
      <label className="file-button">Charger un fichier HTML<input type="file" accept=".html,.htm,text/html" onChange={(e) => e.target.files?.[0] && props.onLoadFile(e.target.files[0])} /></label>
      <button onClick={props.onCopy}>Copier le HTML final</button>
      <button onClick={props.onDownload}>Télécharger le HTML</button>
      <button onClick={props.onReset}>Réinitialiser</button>
      <span className="divider" />
      <button className={props.visualEditing ? 'active' : ''} onClick={props.onToggleVisualEditing}>Édition visuelle {props.visualEditing ? 'ON' : 'OFF'}</button>
      <button onClick={props.onFormat}>Formater</button>
      <button onClick={props.onMinify}>Minifier</button>
      <span className="divider" />
      <button title="Gras" onClick={() => props.onCommand('bold')}><strong>B</strong></button>
      <button title="Italique" onClick={() => props.onCommand('italic')}><em>I</em></button>
      <button title="Liste" onClick={() => props.onCommand('insertUnorderedList')}><span>•</span></button>
      <button title="Liste numérotée" onClick={() => props.onCommand('insertOrderedList')}><span>1.</span></button>
      <button title="Lien" onClick={() => { const url = window.prompt('URL du lien'); if (url) props.onCommand('createLink', url); }}><span>🔗</span></button>
    </header>
  );
}
