import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, useNavigate } from 'react-router-dom';
const dir=mkdtempSync(resolve('node_modules/.remaining-ui-'));
after(()=>rmSync(dir,{recursive:true,force:true}));
const outfile=resolve(dir,'ui.mjs');
await build({stdin:{contents:"export { default as WaitlistForm } from './packages/landing/src/components/WaitlistForm'; export { default as Reservation } from './packages/landing/src/components/Reservation'; export { default as App, safeReturnPath } from './packages/web/src/App'; export { default as Contacts } from './packages/app-shared/src/screens/Contacts'; export { default as Setup } from './packages/app-shared/src/screens/Setup'; export {api,configureApi} from './packages/app-shared/src/api';",resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',alias:{'@hauddy/app-shared':resolve('packages/app-shared/src/index.ts')},define:{'import.meta.env':'{}'}});
const {App,safeReturnPath,Contacts,Setup,WaitlistForm,Reservation,api,configureApi}=await import(pathToFileURL(outfile));
const progressLabels = root => root.findByProps({'aria-label':'Connection progress'}).findAllByType('li').map(node => node.children.filter(child => typeof child === 'string').join(''));
async function mount(t, component=App, signedIn=true, path='/messages?to=@alpha', overrides={}) {
 const old={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,requestAnimationFrame:globalThis.requestAnimationFrame};
 const values=new Map(signedIn?[['hauddy.platformKey','fixture-key']]:[]);
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 globalThis.window=Object.assign(new EventTarget(),{location:{hash:path.includes('#')?'#'+path.split('#')[1]:'',search:''}});
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 globalThis.requestAnimationFrame=fn=>{fn();return 0;};
 const friends={auto_accept:false,linked:[],incoming:[],outgoing:[]};
 configureApi({getSession:async()=>({email:'me@example.test',name:'me'}),consoleNotifications:async()=>({unread_messages:0,missed_calls:0,friend_requests:0}),listFriends:async()=>friends,consoleDashboard:async()=>({agents:[{id:'a',nickname:'@alpha'}],platform_agents:[],friends,threads:[]}),consoleThread:async peer=>({peer_id:peer,messages:[],items:[]}),consoleInbox:async()=>({messages:[]}),consolePoll:async()=>({frames:[]}),...overrides});
 let navigate,renderer;
 let fileClicks=0,focusCalls=0;
 const inputNode=Object.assign(new EventTarget(),{click(){fileClicks++;}});
 function Wrapper(){navigate=useNavigate();return React.createElement(component);}
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const key of Object.keys(old)){if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}});
 await act(async()=>{renderer=create(React.createElement(MemoryRouter,{initialEntries:[path],future:{v7_startTransition:true,v7_relativeSplatPath:true}},React.createElement(Wrapper)),{createNodeMock:el=>el.type==='input'&&el.props.type==='file'?inputNode:el.type==='button'?{focus(){focusCalls++;}}:null});});
 return {root:renderer.root,navigate:async path=>act(async()=>navigate(path)),inputNode,fileClicks:()=>fileClicks,focusCalls:()=>focusCalls};
}

test('return paths retain queries but reject external URLs, backslashes and login loops',()=>{
 assert.equal(safeReturnPath('/messages?to=%40alpha'),'/messages?to=%40alpha');
 for(const path of ['https://evil.test','//evil.test','/\\evil.test','/login',null])assert.equal(safeReturnPath(path),'/');
});
for(const signedIn of [true,false])test(`conversation links survive ${signedIn?'an existing session':'sign-in'} and later recipient changes`,async t=>{
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(new URL(url).pathname,'/accounts/login');return Response.json({api_key:'fixture-key'});});
 const ui=await mount(t,App,signedIn);
 if(!signedIn){
  await act(async()=>ui.root.findByProps({id:'login-id'}).props.onChange({target:{value:'me'}}));
  await act(async()=>ui.root.findByProps({id:'login-pw'}).props.onChange({target:{value:'password'}}));
  await act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));
 }
 assert.equal(ui.root.findByProps({'aria-label':'Message body'}).props.placeholder,'Message @alpha…');
 await ui.navigate('/messages?to=@beta');
 assert.equal(ui.root.findByProps({'aria-label':'Message body'}).props.placeholder,'Message @beta…');
});

test('attachment button opens the picker, accepts files and restores focus on change/cancel',async t=>{
 const ui=await mount(t);
 const button=ui.root.findByProps({'aria-label':'Attach files'});
 assert.equal(button.type,'button');assert.equal(button.props.type,'button');assert.equal(button.props.disabled,false);
 await act(async()=>button.props.onClick());assert.equal(ui.fileClicks(),1);
 await act(async()=>ui.root.findByProps({type:'file'}).props.onChange({target:{files:[new File(['hello'],'hello.txt')],value:'chosen'}}));
 assert.equal(ui.root.findAllByProps({'aria-label':'Remove hello.txt'}).length,1);
 assert.equal(ui.focusCalls(),1);
 await act(async()=>ui.inputNode.dispatchEvent(new Event('cancel')));assert.equal(ui.focusCalls(),2);
});

for(const [status,code,pattern,retryable] of [[404,'E_UNKNOWN_AGENT',/No one/,false],[400,'E_UNKNOWN_AGENT',/No one/,false],[401,'E_AUTH_FAILED',/session expired/,false],[403,'E_FORBIDDEN',/permission/,false],[429,'rate_limit',/Too many/,true],[500,'server',/server could not/,true]])test(`friend request distinguishes HTTP ${status}`,async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:code},{status}));
 const result=await api.requestFriend('@known');assert.match(result.error,pattern);assert.equal(!!result.retryable,retryable);
});
test('offline friend request retains the handle, prevents duplicates and offers retry',async t=>{
 let finish,requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;return new Promise((_,reject)=>{finish=reject;});});
 const ui=await mount(t,Contacts);
 const field=()=>ui.root.findByProps({'aria-label':'Friend handle'});
 await act(async()=>field().props.onChange({target:{value:'@known'}}));
 await act(async()=>{void ui.root.findByType('form').props.onSubmit({preventDefault(){}});});
 assert.equal(field().props.disabled,true);
 await act(async()=>{void ui.root.findByType('form').props.onSubmit({preventDefault(){}});});assert.equal(requests,1);
 await act(async()=>finish(new TypeError('Failed to fetch')));
 assert.equal(field().props.value,'@known');
 assert.ok(ui.root.findAllByType('button').some(b=>b.props.children==='Retry request'));
 assert.match(ui.root.findByProps({'aria-live':'polite'}).props.children,/connect to the server/);
});
test('setup uses actual connection and message evidence rather than a clicked completion flag',async t=>{
 const ui=await mount(t,Setup,true,'/setup?path=hosted&agent=c',{nicknamesOverview:async()=>({agents:[{id:'c',nickname:'@connector',kind:'connector',online:false,connector:{lastUsedMs:123}}],reserved:[]}),consoleThread:async()=>({peer_id:'c',messages:[{mine:true,body:'hello',outbound_state:'sent'}]})});
 assert.deepEqual(progressLabels(ui.root),['Configured','Connected or seen by Hauddy','First message recorded']);
 assert.ok(ui.root.findByProps({'aria-label':'Connection progress'}).findAllByType('li').every(node => node.props.className === 'complete'));
});


test('changing setup agents clears stale success while the new history is loading',async t=>{
 let resolveSecond;
 const ui=await mount(t,Setup,true,'/setup?path=hosted&agent=first',{nicknamesOverview:async()=>({agents:['first','second'].map(id=>({id,kind:'connector',online:false})),reserved:[]}),consoleThread:async id=>id==='first'?{messages:[{mine:true,outbound_state:'sent',delivered_at:'now'}]}:new Promise(resolve=>{resolveSecond=resolve;})});
 const progress=()=>progressLabels(ui.root);
 assert.equal(progress()[2],'First message recorded');
 await ui.navigate('/setup?path=hosted&agent=second');
 assert.equal(progress()[1],'Waiting for the first connection');
 assert.equal(progress()[2],'Checking message history…');
 await act(async()=>resolveSecond({messages:[]}));
 assert.equal(progress()[2],'Send a first test message');
});

test('recovery requests use neutral confirmation and can be resent',async t=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(new URL(url).pathname,'/accounts/recovery/request');assert.deepEqual(JSON.parse(options.body),{email:'someone@example.test'});requests++;return Response.json({ok:true});});
 const ui=await mount(t,App,false,'/reset-password');
 await act(async()=>ui.root.findByProps({id:'recovery-email'}).props.onChange({target:{value:'someone@example.test'}}));
 const submit=()=>act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));
 await submit(); assert.match(ui.root.findByProps({role:'status'}).props.children,/If an account uses this address/);
 assert.ok(ui.root.findAllByType('button').some(b=>b.props.children==='Resend reset email'));
 await submit();assert.equal(requests,2);
});

test('reset handles mismatched passwords, expired links, and successful return to sign-in',async t=>{
 let status=410,requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json(status===200?{ok:true}:{error:'This link has expired.'},{status});});
 const ui=await mount(t,App,false,'/reset-password#token=fixture-token');
 await act(async()=>ui.root.findByProps({id:'new-password'}).props.onChange({target:{value:'new-password'}}));
 const submit=()=>act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));
 await submit();assert.equal(requests,0);assert.equal(ui.root.findByProps({role:'alert'}).props.children,'Passwords do not match.');
 await act(async()=>ui.root.findByProps({id:'confirm-password'}).props.onChange({target:{value:'new-password'}}));
 await submit();assert.match(ui.root.findByProps({role:'alert'}).props.children,/expired/);
 assert.equal(ui.root.findByProps({href:'/reset-password'}).props.children,'Request a fresh reset link');
 status=200;await submit();assert.ok(ui.root.findAllByProps({href:'/login'}).some(n=>n.props.children==='Return to sign in'));
});

test('claim retains its invitation token across sign-in and sends authenticated proof',async t=>{
 let claimed=false;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(new URL(url).pathname==='/accounts/login') return Response.json({api_key:'fixture-key'});
  assert.equal(new URL(url).pathname,'/preregistration/claim');
  assert.equal(options.headers.authorization,'Bearer fixture-key');assert.deepEqual(JSON.parse(options.body),{token:'claim-proof'});claimed=true;return Response.json({ok:true,handle:'@held'});
 });
 const ui=await mount(t,App,false,'/claim-handle#token=claim-proof');
 await act(async()=>ui.root.findByProps({id:'login-id'}).props.onChange({target:{value:'me'}}));
 await act(async()=>ui.root.findByProps({id:'login-pw'}).props.onChange({target:{value:'password'}}));
 await act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(ui.root.findByType('h1').props.children,'Claim your agent handle');
 await act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(claimed,true);
});

test('reservation availability ignores stale replies and preserves email when suggesting alternatives',async t=>{
 const pending=new Map();
 t.mock.method(globalThis,'fetch',async url=>new Promise(resolve=>pending.set(new URL(url).searchParams.get('handle'),resolve)));
 const ui=await mount(t,WaitlistForm,true,'/');
 const handle=()=>ui.root.findByProps({placeholder:'@your-agent'});
 await act(async()=>ui.root.findByProps({type:'email'}).props.onChange({target:{value:'kept@example.test'}}));
 await act(async()=>handle().props.onChange({target:{value:'old'}}));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,380)));
 await act(async()=>handle().props.onChange({target:{value:'new'}}));
 await act(async()=>new Promise(resolve=>setTimeout(resolve,380)));
 await act(async()=>pending.get('new')(Response.json({available:false,suggestions:['@new-agent']})));
 await act(async()=>pending.get('old')(Response.json({available:true})));
 assert.match(ui.root.findByProps({role:'status'}).props.children,/unavailable/);
 await act(async()=>ui.root.findAllByType('button').find(b=>b.props.children==='@new-agent').props.onClick());
 assert.equal(handle().props.value,'@new-agent');assert.equal(ui.root.findByProps({type:'email'}).props.value,'kept@example.test');
});

test('reservation email confirmation requires an explicit action and reports expiration',async t=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({error:'This link has expired. Request a new email.'},{status:410});});
 const ui=await mount(t,Reservation,true,'/reservation#token=expired');assert.equal(requests,0);
 await act(async()=>ui.root.findByType('button').props.onClick());assert.equal(requests,1);
 assert.match(ui.root.findByProps({role:'alert'}).props.children,/expired/);
 assert.equal(ui.root.findByProps({href:'/#waitlist'}).props.children,'Request another email or correct your details');
});


test('resends preserve the cancellation receipt and require correcting the held details before editing',async t=>{
 let sends=0,cancelled;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/preregistration/cancel') {cancelled=JSON.parse(options.body).token;return Response.json({ok:true});}
  if(path==='/preregistration/check')return Response.json({available:true});
  return Response.json({ok:true,request_token:++sends===1?'original-receipt':'resend-receipt'});
 });
 const ui=await mount(t,WaitlistForm,true,'/');
 const handle=()=>ui.root.findByProps({placeholder:'@your-agent'});
 await act(async()=>handle().props.onChange({target:{value:'held-agent'}}));
 await act(async()=>ui.root.findByProps({type:'email'}).props.onChange({target:{value:'typo@example.test'}}));
 const submit=()=>act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault(){}}));
 await submit(); assert.equal(handle().props.disabled,true);
 await submit();
 await act(async()=>ui.root.findAllByType('button').find(b=>b.props.children==='Cancel pending request / correct details').props.onClick());
 assert.equal(cancelled,'original-receipt');assert.equal(handle().props.disabled,false);
});
