/** Shared stroke icons for the approved import composition. */
export default function ImportGlyph({kind}:{kind:'layers'|'shield'|'database'|'wrench'|'target'}){
  const paths={layers:<><path d="m3 8 9-5 9 5-9 5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M7 12h3l2-4 2 8 2-4h2"/></>,database:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>,wrench:<path d="M14 4a6 6 0 0 0-7 7L3 17a3 3 0 0 0 4 4l6-6a6 6 0 0 0 7-7l-4 4-4-4 4-4z"/>,target:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></>};
  return <svg viewBox="0 0 24 24" className={`import-glyph glyph-${kind}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
