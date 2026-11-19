import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import RecoveryPanel from './RecoveryPanel';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

it('shows disabled recovery without exposing operator actions',async()=>{
  const fetch=vi.fn(async()=>response({enabled:false}));vi.stubGlobal('fetch',fetch);
  render(<RecoveryPanel/>);
  expect(await screen.findByText(/Recovery controls are disabled/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Create verified backup'})).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('uses an in-memory credential and requires successful verification before restore',async()=>{
  const calls:{url:string;authorization:string|null}[]=[];
  const fetch=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);calls.push({url,authorization:new Headers(init?.headers).get('Authorization')});
    if(url.endsWith('/status'))return response({enabled:true});
    if(url.endsWith('/verify'))return response({state:'verified'});
    if(url.endsWith('/restore'))return response({state:'verified',database_path:'isolated/database.sqlite3',storage_path:'isolated/private-storage',active_store_replaced:false});
    return response({items:[{backup_id:'abc',state:'ready_to_verify'}]});
  });vi.stubGlobal('fetch',fetch);
  const beforeLocal=JSON.stringify(localStorage),beforeSession=JSON.stringify(sessionStorage);
  render(<RecoveryPanel/>);
  const token=await screen.findByLabelText('Recovery operator token');
  fireEvent.change(token,{target:{value:'test-operator-credential'}});
  fireEvent.click(screen.getByRole('button',{name:'Load recovery packages'}));
  await screen.findByText(/abc — Ready for verification/);
  fireEvent.change(screen.getByLabelText('Recovery package'),{target:{value:'abc'}});
  const restore=screen.getByRole('button',{name:'Restore to a new copy'});
  expect(restore).toHaveProperty('disabled',true);
  fireEvent.click(screen.getByRole('button',{name:'Verify selected package'}));
  await waitFor(()=>expect(restore).toHaveProperty('disabled',false));
  fireEvent.click(restore);
  expect(await screen.findByText(/A separate restored copy was created and verified/)).toBeTruthy();
  expect(calls.filter(c=>!c.url.endsWith('/status')).every(c=>c.authorization==='Bearer test-operator-credential')).toBe(true);
  expect(JSON.stringify(localStorage)).toBe(beforeLocal);expect(JSON.stringify(sessionStorage)).toBe(beforeSession);
});

it('revokes earlier verification and never claims success after re-verification fails',async()=>{
  let attempts=0;
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    return url.endsWith('/status')?response({enabled:true}):url.endsWith('/verify')?(++attempts===1?response({state:'verified'}):response({detail:'Checksum mismatch'},409)):response({items:[{backup_id:'bad',state:'ready_to_verify'}]});
  }));
  render(<RecoveryPanel/>);
  fireEvent.change(await screen.findByLabelText('Recovery operator token'),{target:{value:'operator'}});
  fireEvent.click(screen.getByRole('button',{name:'Load recovery packages'}));
  await screen.findByText(/bad — Ready for verification/);
  fireEvent.change(screen.getByLabelText('Recovery package'),{target:{value:'bad'}});
  fireEvent.click(screen.getByRole('button',{name:'Verify selected package'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Restore to a new copy'})).toHaveProperty('disabled',false));
  fireEvent.click(screen.getByRole('button',{name:'Verify selected package'}));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Restore to a new copy'})).toHaveProperty('disabled',true);
  expect(screen.queryByText(/Package verified:/)).toBeNull();
});
