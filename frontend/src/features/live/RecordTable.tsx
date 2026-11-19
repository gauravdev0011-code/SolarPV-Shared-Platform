export default function RecordTable({rows,columns}:{rows:Record<string,any>[];columns:string[]}) {
  if(!rows.length)return <p className="module-empty-state">No records available.</p>;
  return <div className="module-table-scroll"><table className="operations-table module-data-table"><thead><tr>{columns.map(key=><th scope="col" key={key}>{key.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={row.observation_id ?? row.inspection_id ?? row.maintenance_id ?? row.asset_id ?? row.site_id ?? index}>{columns.map(key=><td key={key}>{row[key]==null || row[key]===''?'Not recorded':String(row[key])}</td>)}</tr>)}</tbody></table></div>;
}
