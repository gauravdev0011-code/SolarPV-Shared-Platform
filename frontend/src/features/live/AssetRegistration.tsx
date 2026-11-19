import {useEffect,useRef,useState} from 'react';
import {api,type AssetDraft,type AssetPreview} from '../../api/solaris';
import type {SiteRecord} from '../../api/types';
import './assetRegistration.css';

const empty:AssetDraft={name:'',asset_type:'',external_id:null,description:'',location:'',site_id:null,data_origin:'unknown'};
export default function AssetRegistration({workspaceId,assetId,sites,onSaved}:{workspaceId:string;assetId:string;sites:SiteRecord[];onSaved:(message:string)=>void}){
  const [draft,setDraft]=useState<AssetDraft>({...empty}),[edit,setEdit]=useState(false),[revision,setRevision]=useState(''),[managed,setManaged]=useState(false);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[paste,setPaste]=useState('');
  const [preview,setPreview]=useState<AssetPreview|null>(null),[rows,setRows]=useState<AssetDraft[]>([]);
  const key=useRef(crypto.randomUUID()),bulkKey=useRef(crypto.randomUUID()),mounted=useRef(true),epoch=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  function change(next:AssetDraft){setDraft(next);key.current=crypto.randomUUID();setError('');}
  async function run(action:()=>Promise<void>){const current=++epoch.current;setBusy(true);setError('');try{await action();}catch(e){if(mounted.current&&current===epoch.current)setError((e as Error).message);}finally{if(mounted.current&&current===epoch.current)setBusy(false);}}
  return <section className="panel-card live-panel asset-registration" aria-label="Asset registration"><h2>Register or edit equipment</h2>
    <p>Trusted local workspace only. Unknown origin means unverified, not confirmed research data. Equipment identity is never inferred from similar names.</p>
    {error&&<p role="alert">{error}</p>}
    <div><button type="button" disabled={busy} onClick={()=>{setEdit(false);setManaged(false);setRevision('');change({...empty});}}>New asset</button><button type="button" disabled={busy||!assetId} onClick={()=>void run(async()=>{const value=await api.assetRegistration(workspaceId,Number(assetId));if(!mounted.current)return;setEdit(true);setManaged(Boolean(value.configuration_managed));setRevision(value.revision);change({name:value.name,asset_type:value.asset_type,external_id:value.external_id,description:value.description??'',location:value.location??'',site_id:value.site_id,data_origin:value.data_origin});})}>Edit selected asset</button></div>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{const saved=await api.saveAsset(workspaceId,draft,key.current,edit?Number(assetId):undefined,revision);if(mounted.current)onSaved(`Asset ${saved.external_id||saved.name} saved with its stable identity.`);});}}>
      <fieldset disabled={busy}><legend>{edit?'Edit selected equipment':'Register equipment'}</legend>
        <label>Equipment name<input required maxLength={200} value={draft.name} onChange={e=>change({...draft,name:e.target.value})}/></label>
        <label>Equipment type<input required maxLength={200} placeholder="For example: panel or inverter" value={draft.asset_type} onChange={e=>change({...draft,asset_type:e.target.value})}/></label>
        <label>External identifier (optional)<input maxLength={200} value={draft.external_id??''} onChange={e=>change({...draft,external_id:e.target.value||null})}/></label>
        <label>Location<input maxLength={2000} value={draft.location} onChange={e=>change({...draft,location:e.target.value})}/></label>
        <label>Description<textarea maxLength={2000} value={draft.description} onChange={e=>change({...draft,description:e.target.value})}/></label>
        <label>Site<select disabled={edit&&managed} value={draft.site_id??''} onChange={e=>change({...draft,site_id:e.target.value||null})}><option value="">No recorded site</option>{sites.map(s=><option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label>
        <label>Data origin<select disabled={edit} value={draft.data_origin} onChange={e=>change({...draft,data_origin:e.target.value as AssetDraft['data_origin']})}><option value="unknown">Unknown / unverified</option><option value="real">Research equipment (explicit declaration)</option><option value="synthetic">Synthetic / test equipment</option></select></label>
        {managed&&<p>Site association is versioned. Use Physical hierarchy & specifications to record a documented site change.</p>}{edit&&<p>Origin is preserved as provenance. Reload the selected asset before retrying a conflicting edit.</p>}
        <button type="submit">{edit?'Save asset changes':'Register asset'}</button>
      </fieldset>
    </form>
    <details><summary>Register several assets</summary><p>Paste up to 100 spreadsheet rows, without a header: external identifier, equipment name, equipment type, separated by tabs. All rows start with unknown origin and no inferred site. Exact identifiers in this workspace are checked before saving. Different existing details require individual editing.</p>
      <label>Spreadsheet rows<textarea disabled={busy} aria-label="Spreadsheet asset rows" rows={5} value={paste} onChange={e=>{setPaste(e.target.value);setPreview(null);setRows([]);bulkKey.current=crypto.randomUUID();}}/></label>
      <button type="button" disabled={busy||!paste.trim()} onClick={()=>void run(async()=>{
        setPreview(null);
        const parsed=paste.trim().split(/\r?\n/).map((line,index)=>{const cells=line.split('\t').map(v=>v.trim());if(cells.length!==3||cells.some(v=>!v))throw new Error(`Row ${index+1}: provide identifier, name and type in three tab-separated cells.`);return {...empty,external_id:cells[0],name:cells[1],asset_type:cells[2]};});
        if(parsed.length>100)throw new Error('Preview at most 100 rows at a time.');
        const result=await api.previewAssets(workspaceId,parsed);if(mounted.current){setRows(parsed);setPreview(result);bulkKey.current=crypto.randomUUID();}
      })}>Preview asset matches</button>
      {preview&&<><table className="operations-table"><caption>Review exact workspace identifier matches before saving</caption><thead><tr><th scope="col">Identifier</th><th scope="col">Proposed name / type</th><th scope="col">Existing name / type</th><th scope="col">Result</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.row}><td>{r.external_id}</td><td>{r.proposed.name} / {r.proposed.asset_type}</td><td>{r.existing?`${r.existing.name} / ${r.existing.asset_type}`:'None'}</td><td>{r.action}</td></tr>)}</tbody></table>
        {!preview.can_commit&&<p role="status">Conflicting existing assets require individual review. No rows have been saved.</p>}
        <button type="button" disabled={busy||!preview.can_commit} onClick={()=>void run(async()=>{const result=await api.commitAssets(workspaceId,rows,preview.preview_revision,bulkKey.current);if(mounted.current)onSaved(`${result.items.length} assets confirmed; existing matches were not overwritten.`);})}>Confirm and save reviewed assets</button></>}
    </details>
    {busy&&<p role="status">Checking or saving equipment…</p>}
  </section>;
}
