import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const source=ts.transpileModule(readFileSync(new URL('../src/components/payments/payments-page-content.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function load(data) {
 let state=0; const exports={};
 vm.runInNewContext(source,{exports,require:(name)=>{
  if(name==='react')return {...React,useEffect:()=>{},useMemo:(f)=>f(),useState:(fallback)=>[state++===0?data:state===2?false:fallback,()=>{}]};
  if(name.startsWith('@/'))return {};
  return require(name);
 }});
 return exports;
}
const row=(id,status,confirmed_at=null)=>({id,status,confirmed_at,updated_at:'2026-11-15T12:00:00Z',scope_label:'Apertura demo',payee_display_name:id,payer_display_name:id,amount:123.45,rejection_reason:status==='rejected'?'Ficha repetida':null});
const data=Object.freeze({outgoing:Object.freeze([row('Salida sin ficha','pending_proof'),row('Salida con ficha','proof_submitted'),row('Salida confirmada anterior','confirmed','2026-11-24T12:00:00Z'),row('Salida rechazada','rejected'),row('Salida confirmada reciente','confirmed','2026-11-25T12:00:00Z')]),incoming:Object.freeze([row('Entrada sin ficha','pending_proof'),row('Entrada por validar','proof_submitted'),row('Entrada confirmada','confirmed','2026-11-25T12:00:00Z'),row('Entrada rechazada','rejected')])});
test('only confirmed payments are completed; preserve direction and sort confirmations newest first',()=>{
 const groups=load(data).groupSettlements(data);
 assert.equal(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([state,g])=>[state,Object.fromEntries(Object.entries(g).map(([direction,rows])=>[direction,rows.map(({id})=>id)]))]))),JSON.stringify({pending:{outgoing:['Salida sin ficha','Salida con ficha','Salida rechazada'],incoming:['Entrada sin ficha','Entrada por validar','Entrada rechazada']},completed:{outgoing:['Salida confirmada reciente','Salida confirmada anterior'],incoming:['Entrada confirmada']}}));
});
test('real page component separates rows and keeps actions only in pending group',()=>{
 const {PaymentsPageContent}=load(data);const html=renderToStaticMarkup(React.createElement(PaymentsPageContent));
 const pending=html.match(/<section[^>]*aria-labelledby="pagos-pendientes"[\s\S]*?<\/section>/)?.[0];
 const completed=html.match(/<section[^>]*aria-labelledby="pagos-completados"[\s\S]*?<\/section>/)?.[0];
 assert.ok(pending&&completed);assert.match(pending,/\(6\)/);assert.match(completed,/\(3\)/);
 assert.match(pending,/Entrada por validar/);assert.match(pending,/Salida rechazada/);assert.match(pending,/Ficha repetida/);
 assert.match(pending,/Enviar ficha/);assert.match(pending,/>Confirmar</);
 assert.doesNotMatch(pending,/confirmada reciente|Entrada confirmada/);
 const detailsStart=completed.match(/<details\b[^>]*>/)?.[0];
 const summary=completed.match(/<summary\b[^>]*>[\s\S]*?<\/summary>/)?.[0];
 assert.ok(detailsStart&&summary);
 assert.doesNotMatch(detailsStart,/\bopen(?:=|\s|>)/);
 assert.match(summary,/Completados[\s\S]*?\(3\)/);
 assert.doesNotMatch(summary,/Salida confirmada|Entrada confirmada/);
 assert.doesNotMatch(pending,/<details[^>]*group\/completed/);
 assert.match(completed,/Salida confirmada reciente/);assert.match(completed,/Entrada confirmada/);
 assert.doesNotMatch(completed,/Enviar ficha|>Confirmar<|>Rechazar<|Entrada por validar/);
 assert.match(html,/Te falta enviar ficha<\/dt><dd[^>]*>2<\/dd>/);assert.match(html,/Te falta validar<\/dt><dd[^>]*>1<\/dd>/);
});
test('empty payments have two explicit empty states',()=>{
 const {PaymentsPageContent}=load({outgoing:[],incoming:[]});const html=renderToStaticMarkup(React.createElement(PaymentsPageContent));
 assert.match(html,/No hay pagos pendientes/);assert.match(html,/No hay pagos completados/);
});
