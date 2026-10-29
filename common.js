/* 컴활 공통 모듈: 문제 기록 저장 · 기기 간 동기화(비공개 GitHub Gist) · CBT 문제 잠금 해제
   - 런처(index.html) · CBT(cbt.html) · 위키(wiki.html)가 함께 쓰고, METRO는 같은 토큰과 Gist를 쓴다.
   - window.CS_MODE: 'online'(깃허브 페이지) | 'offline'(USB 묶음) | 'local'(동기화 없음) */
(function(){
'use strict';
const MODE=window.CS_MODE||(location.protocol==='file:'?'offline':'online');
const P='cs_', FILE='comhwal-shared.json', MFILE='comhwal-metro-progress.json', API='https://api.github.com';
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
          set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const get=(k,d)=>ls.get(P+k,d), set=(k,v)=>ls.set(P+k,v);
/* 토큰과 Gist는 METRO와 같은 저장소 키(cm_)를 쓴다 */
const tok=()=>MODE==='online'?ls.get('cm_ghToken',''):'', gid=()=>ls.get('cm_gistId','');
const hdr=()=>({'Authorization':'Bearer '+tok(),'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'});
const subs=new Set(); let state={kind:tok()?'ok':'off',msg:''};

/* ---------- 예전 CBT 기록 옮기기 (cbt2- → cs_) */
(function migrate(){
  if(get('mig',0)) return;
  const h=ls.get('cbt2-hist',[]), w=ls.get('cbt2-wrong',[]);
  const hist=get('hist',[]); h.forEach(x=>{if(!hist.some(y=>y.d===x.d))hist.push(x)}); set('hist',hist);
  const res=get('res',{}); const t=Date.now()-1; w.forEach(id=>{if(!res[id])res[id]=[0,t,1]}); set('res',res);
  set('mig',1);
})();

/* ---------- 링크로 열기: #sync=토큰&key=비밀번호 (주소창에서 바로 지움) */
(function fromLink(){
  const h=location.hash||''; if(!/(^#|&)(sync|key)=/.test(h)) return;
  const m=/(?:^#|&)sync=((?:ghp_|github_pat_)[A-Za-z0-9_]+)/.exec(h), k=/(?:^#|&)key=([^&]+)/.exec(h);
  if(m&&m[1]!==ls.get('cm_ghToken','')){ls.set('cm_ghToken',m[1]);ls.set('cm_gistId','')}
  if(k){try{set('key',decodeURIComponent(k[1]))}catch(e){}}
  const rest=h.replace(/^#/,'').split('&').filter(x=>!/^(sync|key)=/.test(x)).join('&');
  try{history.replaceState(null,'',location.pathname+location.search+(rest?'#'+rest:''))}catch(e){}
})();

/* ---------- 기록 */
function snapshot(){return{v:1,updated:Date.now(),res:get('res',{}),hist:get('hist',[])}}
function merge(remote){
  if(!remote||typeof remote!=='object') return false;
  const res=get('res',{}), r=remote.res||{}; let ch=false;
  for(const id in r){const a=res[id], b=r[id]; if(!a||b[1]>a[1]){res[id]=[b[0],b[1],Math.max(b[2]||1,a?a[2]||1:0),b[3]==null?-1:b[3],Math.max(b[4]||0,a?a[4]||0:0)];ch=true}}
  const hist=get('hist',[]); (remote.hist||[]).forEach(x=>{if(!hist.some(y=>y.d===x.d)){hist.push(x);ch=true}});
  hist.sort((a,b)=>a.d-b.d);
  set('res',res); set('hist',hist.slice(-60));
  return ch;
}
/* 기록: [맞힘 1/0, 시각, 푼 횟수, 고른 보기(-1 = 안 품), 틀린 횟수] */
function record(id,ok,pick){const res=get('res',{}), a=res[id]; res[id]=[ok?1:0,Date.now(),(a?a[2]||1:0)+1,pick==null?-1:pick,(a?a[4]||0:0)+(ok?0:1)]; set('res',res); soon(); emit('data')}
function addHist(h){const hist=get('hist',[]); hist.push(Object.assign({d:Date.now()},h)); set('hist',hist.slice(-60)); soon(); emit('data')}
function stats(prefix){
  const res=get('res',{}); let n=0,ok=0;
  for(const id in res){if(prefix&&!prefix(id))continue; n++; if(res[id][0])ok++}
  return {n,ok};
}

/* ---------- 동기화 */
let timer=null,busy=false,again=false;
function emit(what){subs.forEach(f=>{try{f(what,state)}catch(e){}})}
function status(kind,msg){state={kind,msg:msg||''}; emit('status')}
async function findOrCreate(){
  if(gid()){const r=await fetch(API+'/gists/'+gid(),{headers:hdr(),cache:'no-store'}); if(r.ok) return gid()}
  for(let page=1;page<=5;page++){
    const r=await fetch(API+`/gists?per_page=100&page=${page}`,{headers:hdr(),cache:'no-store'});
    if(r.status===401){ls.set('cm_ghToken','');throw new Error('토큰이 맞지 않아요. 새 토큰을 다시 붙여 넣어 주세요.')}
    if(!r.ok) throw new Error('GitHub에 연결하지 못했어요 ('+r.status+').');
    const list=await r.json(); const hit=list.find(g=>g.files&&(g.files[FILE]||g.files[MFILE]));
    if(hit){ls.set('cm_gistId',hit.id);return hit.id}
    if(list.length<100) break;
  }
  const r=await fetch(API+'/gists',{method:'POST',headers:hdr(),body:JSON.stringify({description:'컴활 METRO 학습 기록 (자동 저장)',public:false,files:{[FILE]:{content:JSON.stringify(snapshot())}}})});
  if(r.status===401||r.status===403||r.status===404){ls.set('cm_ghToken','');throw new Error('토큰에 gist 권한이 없어요.')}
  if(!r.ok) throw new Error('기록 파일을 만들지 못했어요 ('+r.status+').');
  const g=await r.json(); ls.set('cm_gistId',g.id); return g.id;
}
async function run(){
  if(!tok()){status('off');return}
  if(busy){again=true;return} busy=true; status('busy','동기화 중');
  try{
    const id=await findOrCreate();
    const r=await fetch(API+'/gists/'+id,{headers:hdr(),cache:'no-store'});
    if(r.status===401) ls.set('cm_ghToken','');
    if(!r.ok) throw new Error(r.status===401?'토큰이 만료됐어요. 새 토큰으로 다시 연결해 주세요.':'기록을 불러오지 못했어요 ('+r.status+').');
    const g=await r.json(); const f=g.files&&g.files[FILE]; let remote=null;
    if(f){let txt=f.content; if(f.truncated) txt=await (await fetch(f.raw_url,{cache:'no-store'})).text(); try{remote=JSON.parse(txt)}catch(e){}}
    if(merge(remote)) emit('data');
    const mine=JSON.stringify({res:get('res',{}),hist:get('hist',[])});
    if(!remote||JSON.stringify({res:remote.res||{},hist:remote.hist||[]})!==mine){
      const p=await fetch(API+'/gists/'+id,{method:'PATCH',headers:hdr(),body:JSON.stringify({files:{[FILE]:{content:JSON.stringify(snapshot())}}})});
      if(!p.ok) throw new Error('기록을 저장하지 못했어요 ('+p.status+').');
    }
    set('last',Date.now()); status('ok');
  }catch(e){status('err',e&&e.message&&!/fetch/i.test(e.message)?e.message:'인터넷 연결을 확인해 주세요. 연결되면 다시 저장해요.')}
  finally{busy=false; if(again){again=false; run()}}
}
function soon(){if(!tok())return; clearTimeout(timer); timer=setTimeout(run,2500); status('busy','저장 대기 중')}
if(tok()){setTimeout(run,300); document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')run()})}

/* ---------- CBT 문제 (온라인은 암호화 파일, 오프라인은 평문 파일) */
const DIR=(document.currentScript&&document.currentScript.src||'').replace(/[^/]*$/,'');
function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=DIR+src;s.onload=ok;s.onerror=()=>no(new Error('load'));document.head.appendChild(s)})}
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function decrypt(pw){
  const E=window.CBT_ENC; if(!E) throw new Error('nodata');
  if(!(window.crypto&&crypto.subtle)) throw new Error('nocrypto');
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(E.s),iterations:E.n,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
  const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(E.i)},key,b64(E.c));
  return JSON.parse(new TextDecoder().decode(buf));
}
let cbtP=null;
function loadCBT(){
  if(window.CBT_PLAIN) return Promise.resolve(window.CBT_PLAIN);
  if(cbtP) return cbtP;
  if(MODE==='offline'||MODE==='local') return cbtP=loadScript('cbt-data.js').then(()=>window.CBT_PLAIN||null).catch(()=>null);
  const pw=get('key',''); if(!pw) return Promise.resolve(null);
  return cbtP=loadScript('cbt-data.enc.js').then(()=>decrypt(pw)).then(d=>{window.CBT_PLAIN=d;return d}).catch(e=>{cbtP=null;if(e.message!=='load'&&e.message!=='nocrypto')set('key','');return null});
}
async function unlock(pw){
  pw=String(pw||'').trim(); if(!pw) return false;
  if(!window.CBT_ENC){try{await loadScript('cbt-data.enc.js')}catch(e){return false}}
  try{const d=await decrypt(pw); set('key',pw); window.CBT_PLAIN=d; cbtP=Promise.resolve(d); emit('unlock'); return true}catch(e){return false}
}
const locked=()=>!window.CBT_PLAIN&&MODE==='online'&&!get('key','');

/* ---------- 동기화 단추 + 설정 창 (어느 화면에서나 같은 모양) */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtT=t=>{if(!t)return '아직 없음';const d=new Date(t);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`};
let css=false;
function injectCSS(){if(css)return;css=true;const s=document.createElement('style');s.textContent=`
.cs-pill{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid currentColor;background:none;color:inherit;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;opacity:.92;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.cs-pill i{width:8px;height:8px;border-radius:50%;background:#9aa2b8;flex:none}
.cs-pill[data-k=ok] i{background:#2fbf71}.cs-pill[data-k=busy] i{background:#f2b632}.cs-pill[data-k=err] i{background:#ef5a4c}
.cs-ov{position:fixed;inset:0;z-index:1000;background:rgba(10,12,20,.5);display:grid;place-items:center;padding:16px}
.cs-dlg{width:min(440px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:#fff;color:#1d2333;border-radius:14px;padding:20px;font:15px/1.6 "IBM Plex Sans KR","Malgun Gothic",sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.3)}
.cs-dlg h3{margin:0 0 4px;font-size:18px}.cs-dlg p{margin:6px 0;color:#5b6478;font-size:14px}.cs-dlg b{color:#1d2333}
.cs-dlg .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.cs-dlg input{flex:1;min-width:0;min-height:42px;border:1px solid #cfd4e0;border-radius:8px;padding:0 10px;font:inherit;font-size:16px;background:#fff;color:#1d2333}
.cs-dlg button{min-height:42px;border-radius:8px;border:1px solid #cfd4e0;background:#f3f5fa;color:#1d2333;padding:0 14px;font:inherit;font-size:14px;cursor:pointer}
.cs-dlg button.pri{background:#2f45c7;border-color:#2f45c7;color:#fff}
.cs-dlg hr{border:0;border-top:1px solid #e4e7ef;margin:14px 0}
.cs-dlg .st{font-size:14px;padding:8px 10px;border-radius:8px;background:#f3f5fa;color:#1d2333}
.cs-dlg .x{float:right;min-height:32px;border:0;background:none;font-size:22px;padding:0 4px;line-height:1}
.cs-dlg textarea{width:100%;font:12px ui-monospace,Menlo,monospace;min-height:64px;margin-top:8px;border-radius:8px;border:1px solid #cfd4e0;padding:8px;color:#1d2333;background:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .cs-dlg{background:#191c27;color:#e7e9f2}:root:not([data-theme=light]) .cs-dlg b{color:#e7e9f2}:root:not([data-theme=light]) .cs-dlg p{color:#9aa2b8}:root:not([data-theme=light]) .cs-dlg input,:root:not([data-theme=light]) .cs-dlg textarea{background:#11131a;color:#e7e9f2;border-color:#2c3142}:root:not([data-theme=light]) .cs-dlg button{background:#20242f;color:#e7e9f2;border-color:#2c3142}:root:not([data-theme=light]) .cs-dlg .st{background:#20242f;color:#e7e9f2}:root:not([data-theme=light]) .cs-dlg hr{border-color:#2c3142}}
:root[data-theme=dark] .cs-dlg{background:#191c27;color:#e7e9f2}:root[data-theme=dark] .cs-dlg b{color:#e7e9f2}:root[data-theme=dark] .cs-dlg p{color:#9aa2b8}:root[data-theme=dark] .cs-dlg input,:root[data-theme=dark] .cs-dlg textarea{background:#11131a;color:#e7e9f2;border-color:#2c3142}:root[data-theme=dark] .cs-dlg button{background:#20242f;color:#e7e9f2;border-color:#2c3142}:root[data-theme=dark] .cs-dlg .st{background:#20242f;color:#e7e9f2}:root[data-theme=dark] .cs-dlg hr{border-color:#2c3142}
`;document.head.appendChild(s)}
function pillText(){
  if(MODE!=='online') return ['off','이 기기에 저장'];
  const k=state.kind; if(!tok()) return ['off','동기화 꺼짐'];
  return [k,k==='busy'?'저장 중':k==='err'?'동기화 오류':'동기화됨'];
}
function mountPill(el){
  injectCSS(); const b=document.createElement('button'); b.type='button'; b.className='cs-pill';
  const upd=()=>{const [k,t]=pillText(); b.dataset.k=k; b.innerHTML=`<i></i>${t}`; b.setAttribute('aria-label','동기화 상태: '+t)};
  upd(); subs.add((w)=>{if(w==='status')upd()}); b.onclick=openPanel; el.appendChild(b); return b;
}
function openPanel(){
  injectCSS(); const ov=document.createElement('div'); ov.className='cs-ov';
  const close=()=>{document.removeEventListener('keydown',kd);window.UIX?UIX.close(ov,()=>ov.remove()):ov.remove()}; const kd=e=>{if(e.key==='Escape')close()};
  const draw=()=>{
    const on=!!tok(), st=stats(), key=get('key','');
    const line=MODE!=='online'?'<b>이 기기에만 저장</b> · 인터넷 없는 묶음이라 동기화하지 않아요.'
      :!on?'<b>꺼져 있어요.</b> 기록은 이 기기에만 저장돼요.'
      :state.kind==='err'?`<b style="color:#ef5a4c">${esc(state.msg)}</b>`
      :state.kind==='busy'?esc(state.msg||'동기화 중'):`<b style="color:#2fbf71">✓ 연결됨</b> · 마지막 동기화 ${fmtT(get('last',0))}`;
    ov.innerHTML=`<div class="cs-dlg" role="dialog" aria-modal="true" aria-labelledby="csT"><button class="x" type="button" data-a="x" aria-label="닫기">×</button>
    <h3 id="csT">기록 동기화</h3>
    <p>METRO, CBT, 위키 문제 기록을 휴대폰과 컴퓨터에서 같이 써요. 푼 문제 ${st.n}개 · 맞힌 문제 ${st.ok}개</p>
    <div class="st">${line}</div>
    ${MODE!=='online'?'':on?`<div class="row"><button class="pri" type="button" data-a="now">지금 동기화</button><button type="button" data-a="link">다른 기기 연결 주소</button><button type="button" data-a="off">끊기</button></div><div id="csLink"></div>`
      :`<p>GitHub에서 <b>gist 권한만 있는 토큰</b>을 만들어 붙여 넣으면 켜져요. METRO에서 이미 연결했다면 자동으로 켜져 있어요.</p><div class="row"><input id="csTok" type="password" placeholder="ghp_ 로 시작하는 토큰" autocomplete="off"><button class="pri" type="button" data-a="con">연결</button></div>`}
    ${MODE==='online'?`<hr><h3>기출문제 잠금</h3><p>${key?'<b>풀려 있어요.</b> CBT와 위키의 기출문제를 이 기기에서 볼 수 있어요.':'CBT 기출문제는 개인 학습용이라 비밀번호로 잠가 두었어요.'}</p>
    ${key?'<div class="row"><button type="button" data-a="lock">이 기기에서 다시 잠그기</button></div>':'<div class="row"><input id="csKey" type="password" placeholder="비밀번호" autocomplete="off"><button class="pri" type="button" data-a="unlock">풀기</button></div><p id="csKeyMsg"></p>'}`:''}
    </div>`;
  };
  draw(); document.body.appendChild(ov); document.addEventListener('keydown',kd);
  const sub=(w)=>{if(document.body.contains(ov)&&w==='status'&&!ov.querySelector('input:focus'))draw()}; subs.add(sub);
  ov.addEventListener('click',async e=>{
    if(e.target===ov){close();return}
    const a=e.target.closest('[data-a]'); if(!a) return; const k=a.dataset.a;
    if(k==='x') close();
    if(k==='now') run();
    if(k==='off'){ls.set('cm_ghToken','');ls.set('cm_gistId','');status('off');draw()}
    if(k==='con'){const t=ov.querySelector('#csTok').value.trim(); if(!/^(ghp_|github_pat_)/.test(t)){ov.querySelector('.st').innerHTML='<b style="color:#ef5a4c">ghp_ 로 시작하는 토큰을 붙여 넣어 주세요.</b>';return} ls.set('cm_ghToken',t); ls.set('cm_gistId',''); draw(); run()}
    if(k==='link'){const u=location.origin+location.pathname.replace(/[^/]*$/,'')+'index.html#sync='+tok()+(get('key','')?'&key='+encodeURIComponent(get('key','')):'');
      const box=ov.querySelector('#csLink'); box.innerHTML=`<p>이 주소를 다른 기기에서 열면 동기화와 기출문제 잠금 해제가 한 번에 돼요. 토큰이 들어 있으니 남에게 보내지 마세요.</p><textarea readonly aria-label="연결 주소">${esc(u)}</textarea><p id="csCp"></p>`;
      try{await navigator.clipboard.writeText(u); box.querySelector('#csCp').textContent='복사했어요.'}catch(err){const t=box.querySelector('textarea');t.focus();t.select()}}
    if(k==='unlock'){const ok=await unlock(ov.querySelector('#csKey').value); if(ok) draw(); else ov.querySelector('#csKeyMsg').innerHTML='<b style="color:#ef5a4c">비밀번호가 맞지 않아요.</b>'}
    if(k==='lock'){set('key','');draw();emit('lock')}
  });
  ov.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='csTok')ov.querySelector('[data-a=con]').click(); if(e.key==='Enter'&&e.target.id==='csKey')ov.querySelector('[data-a=unlock]').click()});
  const f=ov.querySelector('input,button.pri'); f&&f.focus();
}

window.CS={MODE,get,set,record,addHist,stats,res:()=>get('res',{}),hist:()=>get('hist',[]),sync:run,on:f=>subs.add(f),
  loadCBT,unlock,locked,mountPill,openPanel,lsGet:ls.get};
})();
