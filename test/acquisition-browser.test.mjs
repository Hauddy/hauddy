import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const bundle = await build({ entryPoints:['packages/landing/src/acquisition.ts'],bundle:true,write:false,format:'iife',globalName:'acquisition',define:{'import.meta.env.VITE_HAUDDY_PLATFORM':'"https://fixture.test"'}});
function fixture({storage=new Map(),query='?utm_source=github_release_alpha',fail=false,blocked=false}={}) {
  const requests=[];
  const context={window:{location:{search:query}},URLSearchParams,sessionStorage:{getItem:k=>{if(blocked)throw Error();return storage.get(k)},setItem:(k,v)=>{if(blocked)throw Error();storage.set(k,v)}},fetch:async(url,options)=>{requests.push({url,...JSON.parse(options.body)});return {ok:!fail}}};
  vm.runInNewContext(bundle.outputFiles[0].text,context);
  return {api:context.acquisition,requests,storage};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('browser deduplicates in-flight and same-tab actions and preserves first source across pages',async()=>{
  const a=fixture();a.api.trackAction('page_view');a.api.trackAction('page_view');await settle();
  assert.equal(a.requests.length,1);
  const b=fixture({storage:a.storage,query:'?utm_source=discord_community_alpha'});
  b.api.trackAction('page_view');b.api.trackAction('guide_open');await settle();
  assert.equal(b.requests.length,1);assert.equal(b.requests[0].source,'github_release_alpha');
});
test('unknown personal input collapses, failures may retry, and blocked storage remains optional',async()=>{
  const a=fixture({query:'?utm_source=private%40example.test&token=secret',fail:true});
  a.api.trackAction('download_click');await settle();a.api.trackAction('download_click');await settle();
  assert.equal(a.requests.length,2);assert.equal(a.requests[0].source,'campaign');assert.doesNotMatch(JSON.stringify(a.requests),/private|secret/);
  const b=fixture({blocked:true});b.api.trackAction('demo_play');b.api.trackAction('demo_play');await settle();assert.equal(b.requests.length,1);
});
