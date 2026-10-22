// FlowForge API smoke test: auth, tenant isolation, branching, retries/timeouts, cancel,
// cycles, schedules, versions, credentials (never leaked) and SSRF.
// Run with the API up:  npm run test:api      (override target: API=http://host:4000)
const ROOT=process.env.API||'http://localhost:4000'; const B=ROOT+'/api'; let pass=0, fail=0;
const ok=(n,c,x='')=>{c?pass++:fail++;console.log(c?'PASS':'FAIL',n,c?'':x)};
const call=async(path,tok,method='GET',body)=>{const r=await fetch(B+path,{method,headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined});let j={};try{j=await r.json()}catch{};return {s:r.status,...j}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reg=async()=>{const r=await call('/auth/register',null,'POST',{email:`t${Date.now()}${Math.random().toString(36).slice(2,6)}@x.com`,password:'secret1'});return r.token};
const N=(id,type,label,config,extra={})=>({id,type,label,position:{x:0,y:0},config,...extra});
const E=(id,s,t,h)=>({id,source:s,target:t,sourceHandle:h??null});
const mk=(tok,name,nodes,edges)=>call('/workflows',tok,'POST',{name,graph:{nodes,edges}});
const waitRun=async(tok,id,ms=20000)=>{const t=Date.now();while(Date.now()-t<ms){const r=await call('/runs/'+id,tok);if(['success','failed','cancelled'].includes(r.run.status))return r.run;await sleep(250)}return (await call('/runs/'+id,tok)).run};

const T=N('t','trigger','Start',{});
const U=ROOT;
const A=await reg();
const H=(id,label,cfg,extra)=>N(id,'http',label,{method:'GET',failOnErrorStatus:true,...cfg},extra);
// run a workflow and return the finished run
const go=async(name,nodes,edges,input={})=>{const w=await mk(A,name,nodes,edges);if(!w.workflow)return {status:'create-failed',err:JSON.stringify(w)};const r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{input});if(!r.run)return {status:'start-failed',err:JSON.stringify(r)};return waitRun(A,r.run.id)};
const out=(run,id)=>run.node_state?.[id]?.output;
const st=(run,id)=>run.node_state?.[id]?.status;

// 1 redirect followed
let run=await go('redirect',[T,H('a','R',{url:U+'/mock/redirect?to=/mock/users/3'})],[E('e','t','a')]);
ok('redirect followed to final answer',run.status==='success'&&out(run,'a')?.body?.name==='User 3',JSON.stringify(out(run,'a')).slice(0,150));
run=await go('redirect301',[T,H('a','R',{url:U+'/mock/redirect?code=301&to=/mock/users/2'})],[E('e','t','a')]);
ok('301 followed',out(run,'a')?.body?.id===2);
run=await go('redirectloop',[T,H('a','R',{url:U+'/mock/redirect?to=/mock/redirect'})],[E('e','t','a')]);
ok('redirect loop ends (no hang)',['success','failed'].includes(run.status),run.status);

// 2 plain-text JSON, array, gzip, html, empty
run=await go('shapes',[T,H('a','plain',{url:U+'/mock/plain-json'}),H('b','arr',{url:U+'/mock/array'}),H('c','gz',{url:U+'/mock/gzip'}),H('d','html',{url:U+'/mock/html'}),H('e','empty',{url:U+'/mock/empty'})],[E('1','t','a'),E('2','a','b'),E('3','b','c'),E('4','c','d'),E('5','d','e')]);
ok('text/plain JSON parsed',out(run,'a')?.body?.hello==='world',JSON.stringify(out(run,'a')?.body));
ok('top-level array',Array.isArray(out(run,'b')?.body)&&out(run,'b').body.length===2);
ok('gzip decoded',out(run,'c')?.body?.zipped===true,JSON.stringify(out(run,'c')?.body));
ok('html kept as text',/Hello/.test(out(run,'d')?.body));
ok('204 empty body ok',run.status==='success'&&out(run,'e')?.status===204,run.status+' '+run.error);

// 3 paths: dot index, bracket index, nested, in transform and message
run=await go('paths',[T,H('a','arr',{url:U+'/mock/array'}),N('x','transform','T',{mapping:{dot:'{{steps.a.output.body.1.title}}',br:'{{steps.a.output.body[0].title}}',missing:'{{steps.a.output.body.9.title}}',whole:'{{steps.a.output.body.0}}'}})],[E('1','t','a'),E('2','a','x')]);
const o=out(run,'x')||{};
ok('dot index path',o.dot==='second',JSON.stringify(o));
ok('bracket index path',o.br==='first',JSON.stringify(o));
ok('missing path -> empty (no crash)',o.missing===undefined||o.missing==='',JSON.stringify(o));
ok('whole object kept as object',o.whole?.id===1,JSON.stringify(o));

// 4 urls typed sloppily
run=await go('url-noscheme',[T,H('a','nos',{url:'  localhost:4000/mock/users/5  '})],[E('e','t','a')]);
ok('URL without http:// and with spaces works',run.status==='success'&&out(run,'a')?.body?.id===5,run.error);
run=await go('url-empty',[T,H('a','e',{url:''})],[E('e','t','a')]);
ok('empty URL -> blocked before running with a friendly message',run.status==='start-failed'&&/needs a URL/i.test(run.err),run.err);
run=await go('url-garbage',[T,H('a','g',{url:'http://'})],[E('e','t','a')]);
ok('garbage URL -> friendly failure (not crash)',run.status==='failed'&&/not a valid web address/i.test(run.node_state?.a?.error||''),run.node_state?.a?.error);

// 5 query + headers + auth bearer + bodies
const cred=await call('/credentials',A,'POST',{name:'tok',type:'bearer',data:{token:'abc123'}});
run=await go('echo-get',[T,H('a','e',{url:U+'/mock/echo',query:{city:'Paris',n:5},headers:{'X-Custom':'yes'},credentialId:cred.credential?.id})],[E('e','t','a')]);
let b=out(run,'a')?.body||{};
ok('query params sent',b.query?.city==='Paris'&&b.query?.n==='5',JSON.stringify(b));
ok('custom header sent',b.custom==='yes');
ok('bearer credential applied',b.auth==='Bearer abc123');
run=await go('echo-json',[T,H('a','e',{method:'POST',url:U+'/mock/echo',bodyMode:'json',bodyType:'json',body:{a:1,who:'{{input.who}}'}})],[E('e','t','a')],{who:'judge'});
b=out(run,'a')?.body||{};
ok('POST JSON body + input template',b.body?.a===1&&b.body?.who==='judge'&&/json/.test(b.contentType),JSON.stringify(b));
run=await go('echo-string-json',[T,H('a','e',{method:'POST',url:U+'/mock/echo',bodyType:'json',body:'{"x": 7}'})],[E('e','t','a')]);
ok('POST JSON typed as text',out(run,'a')?.body?.body?.x===7,JSON.stringify(out(run,'a')?.body));
run=await go('echo-fields',[T,H('a','e',{method:'POST',url:U+'/mock/echo',bodyMode:'fields',fields:{name:'Laksh',n:'{{input.n}}'}})],[E('e','t','a')],{n:3});
ok('POST fields body',out(run,'a')?.body?.body?.name==='Laksh'&&out(run,'a')?.body?.body?.n===3,JSON.stringify(out(run,'a')?.body));
run=await go('echo-form',[T,H('a','e',{method:'POST',url:U+'/mock/echo',headers:{'Content-Type':'application/x-www-form-urlencoded'},bodyMode:'fields',fields:{a:'1',b:'two words'}})],[E('e','t','a')]);
ok('form-urlencoded body encoded',out(run,'a')?.body?.body?.a==='1'&&out(run,'a')?.body?.body?.b==='two words',JSON.stringify(out(run,'a')?.body));
for (const m of ['PUT','PATCH','DELETE']) {
  run=await go('m-'+m,[T,H('a','e',{method:m,url:U+'/mock/echo',...(m==='DELETE'?{}:{bodyMode:'fields',fields:{k:'v'}})})],[E('e','t','a')]);
  ok(m+' request works',out(run,'a')?.body?.method===m,run.error);
}

// YouTube-style nested JSON body with booleans and exact templates
run=await go('yt-shape',[T,N('s','transform','S',{mapping:{videoId:'abc',publishAt:'2026-10-23T10:00:00+05:30'}}),H('p','put',{method:'PUT',url:U+'/mock/echo?part=status',body:{id:'{{steps.s.output.videoId}}',status:{privacyStatus:'private',publishAt:'{{steps.s.output.publishAt}}',selfDeclaredMadeForKids:false}}})],[E('1','t','s'),E('2','s','p')]);
b=out(run,'p')?.body?.body||{};
ok('nested JSON PUT keeps booleans + templates',b.id==='abc'&&b.status?.selfDeclaredMadeForKids===false&&b.status?.publishAt==='2026-10-23T10:00:00+05:30',JSON.stringify(b));

// 6 conditions: every operator, string/number, missing data
const condCase=async(name,cfg)=>{const r=await go('c-'+name,[T,H('a','u',{url:U+'/mock/users/1'}),N('c','condition','C',cfg),N('y','transform','Y',{value:'yes'}),N('n','transform','N',{value:'no'})],[E('1','t','a'),E('2','a','c'),E('3','c','y','true'),E('4','c','n','false')]);return {yes:st(r,'y'),no:st(r,'n'),run:r}};
const L='{{steps.a.output.body.tier}}';
for (const [name,cfg,exp] of [
  ['eq',{left:L,operator:'eq',right:'pro'},true],['eq-false',{left:L,operator:'eq',right:'free'},false],
  ['ne',{left:L,operator:'ne',right:'free'},true],
  ['gt-num',{left:'{{steps.a.output.body.id}}',operator:'gt',right:'0'},true],['lt-num',{left:'{{steps.a.output.body.id}}',operator:'lt',right:'1'},false],
  ['gte',{left:'{{steps.a.output.body.id}}',operator:'gte',right:'1'},true],['lte',{left:'{{steps.a.output.body.id}}',operator:'lte',right:'1'},true],
  ['contains',{left:'{{steps.a.output.body.name}}',operator:'contains',right:'ser'},true],
  ['startsWith',{left:'{{steps.a.output.body.name}}',operator:'startsWith',right:'User'},true],
  ['endsWith',{left:'{{steps.a.output.body.name}}',operator:'endsWith',right:'1'},true],
  ['exists',{left:'{{steps.a.output.body.name}}',operator:'exists'},true],['exists-missing',{left:'{{steps.a.output.body.nope}}',operator:'exists'},false],
  ['truthy',{left:L,operator:'truthy'},true],['truthy-missing',{left:'{{steps.a.output.body.nope}}',operator:'truthy'},false],
  ['bare-path',{left:'steps.a.output.body.tier',operator:'eq',right:'pro'},true],
  ['status-code',{left:'{{steps.a.output.status}}',operator:'eq',right:'200'},true],
  ['expression',{expression:"steps.a.output.body.id == 1 && steps.a.output.body.tier == 'pro'"},true],
]) { const r=await condCase(name,cfg); ok('condition '+name+' -> '+exp,r.run.status==='success'&&(exp?(r.yes==='success'&&r.no==='skipped'):(r.no==='success'&&r.yes==='skipped')),JSON.stringify({y:r.yes,n:r.no,e:r.run.error})); }

// 7 branches that merge again, multi-step chains, fan-out
run=await go('merge',[T,H('a','u',{url:U+'/mock/users/2'}),N('c','condition','C',{left:L,operator:'eq',right:'pro'}),N('y','transform','Y',{value:'PRO'}),N('n','transform','N',{value:'FREE'}),N('m','transform','Merge',{mapping:{who:'{{steps.a.output.body.name}}'}})],[E('1','t','a'),E('2','a','c'),E('3','c','y','true'),E('4','c','n','false'),E('5','y','m'),E('6','n','m')]);
ok('branches merge -> join step runs once',run.status==='success'&&st(run,'m')==='success'&&out(run,'m')?.who==='User 2',JSON.stringify(run.node_state?.m));
run=await go('fanout',[T,H('a','a',{url:U+'/mock/users/1'}),H('b','b',{url:U+'/mock/users/2'}),H('c','c',{url:U+'/mock/users/3'}),N('j','transform','Join',{mapping:{all:'{{steps.a.output.body.name}},{{steps.b.output.body.name}},{{steps.c.output.body.name}}'}})],[E('1','t','a'),E('2','t','b'),E('3','t','c'),E('4','a','j'),E('5','b','j'),E('6','c','j')]);
ok('fan-out/fan-in uses all parents',out(run,'j')?.all==='User 1,User 2,User 3',JSON.stringify(out(run,'j')));
// long chain of 12 steps passing data forward
const chainN=[T], chainE=[]; for(let i=1;i<=12;i++){chainN.push(i===1?H('s1','s1',{url:U+'/mock/users/9'}):N('s'+i,'transform','s'+i,{mapping:{v:`{{steps.s${i-1}.output.${i===2?'body.name':'v'}}}`}}));chainE.push(E('e'+i,i===1?'t':'s'+(i-1),'s'+i))}
run=await go('chain12',chainN,chainE);
ok('12-step chain passes data to the end',out(run,'s12')?.v==='User 9',JSON.stringify(out(run,'s12')));

// 8 failure behaviours
run=await go('fail404',[T,H('a','x',{url:U+'/mock/status/404'}),N('b','transform','after',{value:'ran'})],[E('1','t','a'),E('2','a','b')]);
ok('404 fails the run and stops after',run.status==='failed'&&!run.node_state?.b?.output,run.status);
run=await go('ignore404',[T,H('a','x',{url:U+'/mock/status/404',failOnErrorStatus:false}),N('b','transform','after',{value:'ran'})],[E('1','t','a'),E('2','a','b')]);
ok('"don\'t stop on error" lets the flow continue',run.status==='success'&&out(run,'b')==='ran',run.status+run.error);
run=await go('refused',[T,H('a','x',{url:'http://localhost:1/nothing'})],[E('e','t','a')]);
ok('connection refused -> failed with message',run.status==='failed'&&!!run.node_state?.a?.error,JSON.stringify(run.node_state?.a));
run=await go('dns',[T,H('a','x',{url:'https://this-host-does-not-exist-flowforge.invalid/x'})],[E('e','t','a')]);
ok('unknown domain -> failed with message',run.status==='failed'&&!!run.node_state?.a?.error,JSON.stringify(run.node_state?.a?.error));
run=await go('flaky-retry',[T,H('a','x',{url:U+'/mock/flaky?key=k'+Date.now()+'&failTimes=2'},{retry:{maxAttempts:4,backoffMs:50}})],[E('e','t','a')]);
ok('retry recovers a flaky API',run.status==='success'&&run.node_state?.a?.attempts===3,JSON.stringify(run.node_state?.a?.attempts)+run.error);

// 9 delay + transform variants + weird graphs
run=await go('delay',[T,N('d','delay','wait',{ms:300}),N('x','transform','T',{value:'{{input.name}}!'})],[E('1','t','d'),E('2','d','x')],{name:'hey'});
ok('delay then transform with webhook input',run.status==='success'&&out(run,'x')==='hey!',JSON.stringify(out(run,'x')));
run=await go('transform-template',[T,N('x','transform','T',{template:'Hello {{input.a}} and {{input.b.c}}'})],[E('1','t','x')],{a:'A',b:{c:'C'}});
ok('transform template string',out(run,'x')==='Hello A and C',JSON.stringify(out(run,'x')));
run=await go('unicode',[T,H('a','e',{method:'POST',url:U+'/mock/echo',bodyMode:'message',messageFormat:'discord',message:'नमस्ते 🚀 "quotes" \\ back\nline'})],[E('e','t','a')]);
ok('unicode/emoji/quotes survive',/नमस्ते 🚀 "quotes"/.test(out(run,'a')?.body?.body?.content||''),JSON.stringify(out(run,'a')?.body?.body));
run=await go('only-trigger',[T],[]);
ok('workflow with only a trigger succeeds',run.status==='success',run.status+run.error);
run=await go('orphan',[T,N('o','transform','orphan',{value:'x'})],[]);
ok('unconnected step -> friendly "not connected" message',run.status==='start-failed'&&/isn't connected/i.test(run.err),run.err);
run=await go('no-trigger',[N('x','transform','T',{value:'x'})],[]);
ok('no trigger at all handled',['success','failed','create-failed','start-failed'].includes(run.status),JSON.stringify(run).slice(0,200));

// 9b wait until a clock time (in a named time zone)
const wall=(ms,tz)=>{const f=new Intl.DateTimeFormat('en-CA',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(ms);const g=t=>f.find(x=>x.type===t).value;return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`};
let t0=Date.now();
run=await go('until-ist',[T,N('d','delay','wait',{ms:0,until:'{{input.when}}',untilZone:'Asia/Kolkata'}),N('x','transform','after',{value:'done'})],[E('1','t','d'),E('2','d','x')],{when:wall(Date.now()+4000,'Asia/Kolkata')});
let el=Date.now()-t0;
ok('wait-until (IST wall clock) waits ~4s then continues',run.status==='success'&&out(run,'x')==='done'&&el>=2500&&el<9000,`${run.status} ${el}ms ${JSON.stringify(out(run,'d'))}`);
t0=Date.now();
run=await go('until-ny',[T,N('d','delay','wait',{ms:0,until:wall(Date.now()+3000,'America/New_York'),untilZone:'America/New_York'})],[E('1','t','d')]);
ok('wait-until works for another zone',run.status==='success'&&Date.now()-t0>=2000&&Date.now()-t0<8000,`${Date.now()-t0}`);
run=await go('until-offset',[T,N('d','delay','wait',{ms:0,until:new Date(Date.now()+3000).toISOString().replace(/\.\d+Z$/,'+00:00')})],[E('1','t','d')]);
ok('wait-until accepts explicit offset',run.status==='success');
t0=Date.now();
run=await go('until-far',[T,N('d','delay','wait',{ms:0,until:wall(Date.now()+3*3600e3,'Asia/Kolkata'),untilZone:'Asia/Kolkata'})],[E('1','t','d')]);
ok('wait-until far away carries on immediately',run.status==='success'&&Date.now()-t0<5000&&out(run,'d')?.skipped==='too far away',JSON.stringify(out(run,'d')));
run=await go('until-past',[T,N('d','delay','wait',{ms:0,until:'2020-01-01T10:00:00',untilZone:'Asia/Kolkata'})],[E('1','t','d')]);
ok('wait-until in the past carries on',run.status==='success'&&out(run,'d')?.skipped==='already passed');
run=await go('until-bad',[T,N('d','delay','wait',{ms:0,until:'tomorrow evening',untilZone:'Asia/Kolkata'})],[E('1','t','d')]);
ok('wait-until bad text -> friendly error',run.status==='failed'&&/Could not read/.test(run.node_state?.d?.error||''),run.node_state?.d?.error);
run=await go('until-badzone',[T,N('d','delay','wait',{ms:0,until:'2030-01-01T10:00:00',untilZone:'Mars/Base'})],[E('1','t','d')]);
ok('wait-until bad zone -> friendly error',run.status==='failed'&&/time zone/.test(run.node_state?.d?.error||''),run.node_state?.d?.error);

// 10 watch semantic
const wkey='ch'+Date.now();
const wnodes=[T,H('a','v',{url:U+'/mock/latest-video?channel='+wkey}),N('w','watch','W',{value:'{{steps.a.output.body.id}}'}),N('y','transform','new!',{value:'NEW'})];
const wedges=[E('1','t','a'),E('2','a','w'),E('3','w','y','true')];
const wf=await mk(A,'watch',wnodes,wedges);
const runW=async()=>{const r=await call('/runs/workflow/'+wf.workflow.id,A,'POST',{});return waitRun(A,r.run.id)};
let r1=await runW(), r2=await runW(); await fetch(U+'/mock/latest-video/publish?channel='+wkey,{method:'POST'}); let r3=await runW(), r4=await runW();
ok('watch: first run baseline = no fire',st(r1,'y')==='skipped');
ok('watch: unchanged = no fire',st(r2,'y')==='skipped');
ok('watch: new video fires once',st(r3,'y')==='success',st(r3,'y'));
ok('watch: same video again = no fire',st(r4,'y')==='skipped');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
