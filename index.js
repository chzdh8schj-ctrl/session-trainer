const HTML = String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тренажёр к сессии</title>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#202124;background:#f5f6f8}
*{box-sizing:border-box}body{margin:0}header{background:#263b63;color:white;padding:18px 20px}
main{max-width:980px;margin:22px auto;padding:0 14px}.panel{background:white;border:1px solid #e1e4e8;border-radius:14px;padding:18px;margin:12px 0}
h1{font-size:22px;margin:0}h2{font-size:19px;margin:0 0 12px}button{border:0;border-radius:9px;padding:10px 14px;background:#315da8;color:white;font-size:15px;cursor:pointer;margin:4px 4px 4px 0}
button.secondary{background:#e9edf5;color:#263b63}button.danger{background:#a83232}input,textarea,select{width:100%;padding:10px;border:1px solid #cbd1da;border-radius:8px;font:inherit;margin:5px 0 12px;background:white}
label{font-weight:600;font-size:14px} .muted{color:#687386;font-size:13px}.subject,.ticket,.part{border:1px solid #e1e4e8;border-radius:10px;padding:12px;margin:9px 0}
.option{display:block;width:100%;text-align:left;background:#edf1f7;color:#202124;margin:7px 0}.option.correct{background:#d9f2df;color:#145c28}.option.wrong{background:#f8dddd;color:#8b2020}
.row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1;min-width:150px}.hidden{display:none}.note{background:#fff8df;padding:10px;border-radius:8px;margin-top:10px}
</style></head><body>
<header><h1>Тренажёр к сессии</h1></header><main>
<section id="login" class="panel"><h2>Вход</h2><p class="muted">Используй пароль сайта, который будет задан в настройках Cloudflare.</p><label>Пароль</label><input id="pw" type="password" autocomplete="current-password"><button id="loginBtn">Войти</button><p id="loginMsg" class="muted"></p></section>
<div id="app" class="hidden">
<div class="panel"><div class="row"><div><h2>Мои предметы</h2><p class="muted">Данные автоматически сохраняются в облаке.</p></div><div style="text-align:right"><button class="secondary" id="exportBtn">Экспорт копии</button><button class="secondary" id="importBtn">Импорт копии</button><input id="file" type="file" accept="application/json" class="hidden"></div></div>
<div id="subjects"></div><button id="addSubject">+ Добавить предмет</button></div>
<div id="editor" class="panel hidden"></div><div id="study" class="panel hidden"></div>
</div></main>
<script>
let auth="",db={subjects:[],history:[]},activeSubject=null,activeTicket=null,partIndex=0,mode="seq",order=[],orderPos=0;
const $=id=>document.getElementById(id);
async function api(method="GET",body){let r=await fetch("/api/data",{method,headers:{"Authorization":"Basic "+btoa("student:"+auth),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(r.status===401?"Неверный пароль":"Ошибка сохранения: "+r.status);return r.json()}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function save(){await api("PUT",db)}
$("loginBtn").onclick=async()=>{auth=$("pw").value;try{db=await api();$("login").classList.add("hidden");$("app").classList.remove("hidden");render()}catch(e){$("loginMsg").textContent=e.message;auth=""}};
function render(){ $("subjects").innerHTML=db.subjects.length?db.subjects.map(s=>`<div class="subject"><b>${esc(s.name)}</b><div class="muted">${s.tickets.length} билетов</div><button onclick="editSubject('${s.id}')">Открыть</button><button class="secondary" onclick="startStudy('${s.id}','seq')">По порядку</button><button class="secondary" onclick="startStudy('${s.id}','random')">Случайно</button><button class="danger" onclick="delSubject('${s.id}')">Удалить</button></div>`).join(""):"<p class='muted'>Пока пусто. Добавь первый предмет.</p>"}
$("addSubject").onclick=async()=>{let name=prompt("Название предмета:");if(!name?.trim())return;db.subjects.push({id:crypto.randomUUID(),name:name.trim(),tickets:[]});await save();render()};
window.delSubject=async id=>{let s=db.subjects.find(x=>x.id===id);if(confirm(`Удалить предмет «${s.name}» и все его билеты?`)){db.subjects=db.subjects.filter(x=>x.id!==id);await save();render();$("editor").classList.add("hidden");$("study").classList.add("hidden")}};
window.editSubject=id=>{activeSubject=db.subjects.find(x=>x.id===id);$("study").classList.add("hidden");let e=$("editor");e.classList.remove("hidden");e.innerHTML=`<h2>${esc(activeSubject.name)}</h2><div id="ticketList">${activeSubject.tickets.map(t=>`<div class="ticket"><b>${esc(t.title)}</b><div class="muted">${t.parts.length} частей</div><button onclick="editTicket('${t.id}')">Редактировать</button><button class="danger" onclick="delTicket('${t.id}')">Удалить</button></div>`).join("")}</div><button onclick="addTicket()">+ Добавить билет</button>`};
window.addTicket=async()=>{let title=prompt("Название билета или вопроса:");if(!title?.trim())return;activeSubject.tickets.push({id:crypto.randomUUID(),title:title.trim(),parts:[]});await save();editSubject(activeSubject.id)};
window.delTicket=async id=>{activeSubject.tickets=activeSubject.tickets.filter(t=>t.id!==id);await save();editSubject(activeSubject.id)};
window.editTicket=id=>{activeTicket=activeSubject.tickets.find(t=>t.id===id);let e=$("editor");e.innerHTML=`<h2>${esc(activeTicket.title)}</h2><div id="parts">${activeTicket.parts.map((p,i)=>`<div class="part"><b>${esc(p.title)}</b><button onclick="editPart(${i})">Изменить</button></div>`).join("")}</div><button onclick="editPart(-1)">+ Добавить часть / вопрос</button><button class="secondary" onclick="editSubject(activeSubject.id)">Назад к билетам</button>`};
window.editPart=i=>{let p=i<0?{title:"",question:"",options:["","",""],correct:0,note:""}:activeTicket.parts[i];let e=$("editor");e.innerHTML=`<h2>${i<0?"Новая часть":"Редактирование части"}</h2><label>Название части</label><input id="pt" value="${esc(p.title)}"><label>Вопрос</label><textarea id="pq" rows="3">${esc(p.question)}</textarea><label>Варианты ответов (каждый в отдельном поле)</label>${[0,1,2,3].map(n=>`<label>Вариант ${n+1}</label><input id="o${n}" value="${esc(p.options[n]||"")}">`).join("")}<label>Номер правильного ответа (1–4)</label><input id="correct" type="number" min="1" max="4" value="${p.correct+1}"><label>Краткий конспект при ошибке</label><textarea id="note" rows="3">${esc(p.note)}</textarea><button id="savePart">Сохранить часть</button><button class="secondary" onclick="editTicket(activeTicket.id)">Отмена</button>`;
$("savePart").onclick=async()=>{let options=[0,1,2,3].map(n=>$("o"+n).value.trim()).filter(Boolean);let item={title:$("pt").value.trim(),question:$("pq").value.trim(),options,correct:Math.max(0,Math.min(options.length-1,Number($("correct").value)-1)),note:$("note").value.trim()};if(!item.title||!item.question||options.length<2){alert("Заполни название, вопрос и минимум два варианта.");return}if(i<0)activeTicket.parts.push(item);else activeTicket.parts[i]=item;await save();editTicket(activeTicket.id)}};
window.startStudy=id=>{activeSubject=db.subjects.find(s=>s.id===id);order=activeSubject.tickets.map(t=>t.id);if(mode==="random")order.sort(()=>Math.random()-.5);orderPos=0;openTicket()};
function startStudy(id,m){mode=m;window.startStudy(id)}
function openTicket(){if(orderPos>=order.length){$("study").innerHTML="<h2>Билеты закончились!</h2><button onclick=\"editSubject(activeSubject.id)\">Вернуться к предмету</button>";$("study").classList.remove("hidden");return}activeTicket=activeSubject.tickets.find(t=>t.id===order[orderPos]);partIndex=0;showPart()}
function showPart(){let p=activeTicket.parts[partIndex],s=$("study");s.classList.remove("hidden");if(!p){s.innerHTML=`<h2>${esc(activeTicket.title)}</h2><p>В этом билете пока нет частей.</p><button onclick="nextTicket()">Следующий билет</button>`;return}s.innerHTML=`<div class="muted">Билет ${orderPos+1} из ${order.length} · Часть ${partIndex+1} из ${activeTicket.parts.length}</div><h2>${esc(activeTicket.title)}</h2><h3>${esc(p.title)}</h3><p>${esc(p.question)}</p><div id="answers">${p.options.map((o,i)=>`<button class="option" onclick="answer(${i})">${esc(o)}</button>`).join("")}</div><div id="feedback"></div>`}
window.answer=async n=>{let p=activeTicket.parts[partIndex],buttons=[...document.querySelectorAll(".option")];buttons.forEach((b,i)=>{b.disabled=true;if(i===p.correct)b.classList.add("correct");if(i===n&&n!==p.correct)b.classList.add("wrong")});let ok=n===p.correct;$("feedback").innerHTML=(ok?"<p>Верно!</p>":`<div class="note"><b>Неверно.</b><br>${esc(p.note||"Повтори эту часть материала.")}</div>`)+`<button onclick="nextPart()">Продолжить</button>`;db.history.push({at:new Date().toISOString(),subject:activeSubject.name,ticket:activeTicket.title,part:p.title,correct:ok});await save()};
window.nextPart=()=>{if(partIndex<activeTicket.parts.length-1){partIndex++;showPart()}else nextTicket()};
window.nextTicket=()=>{orderPos++;openTicket()};
$("exportBtn").onclick=()=>{let a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:"application/json"}));a.href=u;a.download="session-trainer-backup.json";a.click();URL.revokeObjectURL(u)};
$("importBtn").onclick=()=>$("file").click();$("file").onchange=async e=>{try{let x=JSON.parse(await e.target.files[0].text());if(!Array.isArray(x.subjects))throw Error();if(confirm("Заменить текущие данные содержимым копии?")){db=x;await save();render()}}catch{alert("Не удалось прочитать копию.")}};
</script></body></html>`;

async function authorized(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!env.SITE_PASSWORD) return false;
  const expected = "Basic " + btoa("student:" + env.SITE_PASSWORD);
  return h === expected;
}
async function init(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_data (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO app_data (id,data,updated_at) VALUES ('main', ?, datetime('now'))").bind(JSON.stringify({subjects:[],history:[]})).run();
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") {
      if (!(await authorized(request, env))) return new Response("Unauthorized", {status:401});
      try {
        await init(env);
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT data FROM app_data WHERE id='main'").first();
          return Response.json(JSON.parse(row.data));
        }
        if (request.method === "PUT") {
          const data = await request.json();
          if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.history)) return new Response("Bad data",{status:400});
          const serialized = JSON.stringify(data);
          if (serialized.length > 900000) return new Response("Data too large",{status:413});
          await env.DB.prepare("UPDATE app_data SET data=?, updated_at=datetime('now') WHERE id='main'").bind(serialized).run();
          return Response.json({ok:true});
        }
        return new Response("Method not allowed",{status:405});
      } catch(e) { return new Response("Database error: "+e.message,{status:500}); }
    }
    return new Response(HTML,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }
};
