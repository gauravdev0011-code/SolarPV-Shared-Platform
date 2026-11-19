import {useEffect,useRef,type ReactNode} from 'react';

/** One focus-contained evidence surface; technical tables never size the dashboard grid. */
export default function EvidenceDialog({open,onClose,children}:{open:boolean;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current;if(!dialog)return;
    const previous=document.activeElement as HTMLElement|null;
    if(open){if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal();}else dialog.setAttribute('open','');}
    else if(dialog.open){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
    return()=>{if(open)previous?.focus?.();};
  },[open]);
  return <dialog ref={ref} className="import-evidence-dialog" aria-label="Dataset evidence" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="evidence-dialog-header"><div><strong>Dataset evidence &amp; review</strong><p>Original values, saved revisions and scientific decisions.</p></div><button type="button" onClick={onClose} aria-label="Close dataset evidence">Close ×</button></header>
    {children}
  </dialog>;
}
