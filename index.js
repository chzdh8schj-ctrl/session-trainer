const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тренажёр к сессии</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#202536;font:16px system-ui,sans-serif}header{background:#263b63;color:white;padding:18px}main{max-width:900px;margin:22px auto;padding:0 14px}.panel,.item{background:white;border:1px solid #e0e5ee;border-radius:13px;padding:16px;margin:12px 0}h1{font-size:22px;margin:0}h2{font-size:19px;margin:0 0 12px}button{border:0;border-radius:9px;padding:10px 14px;background:#315da8;color:white;font-size:15px;cursor:pointer;margin:4px 4px 4px 0}button:disabled{opacity:.65}button.secondary{background:#e8edf6;color:#263b63}button.danger{background:#a83232}input,textarea{width:100%;padding:10px;border:1px solid #cbd2df;border-radius:8px;font:inherit;margin:5px 0 12px}label{font-weight:600;font-size:14px}.muted{color:#687386;font-size:13px}.option{display:block;width:100%;text-align:left;background:#edf1f7;color:#202124;margin:7px 0}.option.correct{background:#d9f2df;color:#145c28}.option.wrong{background:#f8dddd;color:#8b2020}.hidden{display:none}.note{background:#fff8df;padding:11px;border-radius:8px;margin-top:10px}
</style></head><body><header><h1>Тренажёр к сессии</h1></header><main>
<section id="login" class="panel"><h2>Вход</h2><p class="muted">Введи пароль, который задан в Cloudflare.</p><label>Пароль</label><input id="pw" type="password"><button id="loginBtn">Войти</button><p id="loginMsg" class="muted"></p></section>
<div id="app" class="hidden"><section class="panel"><h2>Мои предметы</h2><p class="muted">Данные сохраняются в облачной базе.</p><button id="exportBtn" class="secondary">Скачать резервную копию</button><button id="importBtn" class="secondary">Импортировать копию</button><input id="file" type="file" accept="application/json" class="hidden"><div id="subjects"></div><button id="addSubject">+ Добавить предмет</button></section><section id="editor" class="panel hidden"></section><section id="study" class="panel hidden"></section></div></main>
<script>
let auth="",db={subjects:[],history:[]},subject=null,ticket=null,partIndex=0,order=[],orderPos=0;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(method="GET",body){const r=await fetch("/api/data",{method,headers:{"Authorization":"Basic "+btoa("student:"+auth),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(r.status===401?"Неверный пароль":"Ошибка сервера: "+r.status);return r.json()}
async function save(){await api("PUT",db)}
$("loginBtn").onclick=async()=>{auth=$("pw").value;try{db=await api();$("login").classList.add("hidden");$("app").classList.remove("hidden");render()}catch(e){$("loginMsg").textContent=e.message;auth=""}};
function render(){$("subjects").innerHTML=db.subjects.length?db.subjects.map(s=>`<div class="item"><b>${esc(s.name)}</b><div class="muted">${s.tickets.length} билетов</div><button onclick="editSubject('${s.id}')">Открыть</button><button class="secondary" onclick="startStudy('${s.id}',false)">По порядку</button><button class="secondary" onclick="startStudy('${s.id}',true)">Случайно</button><button class="danger" onclick="deleteSubject('${s.id}')">Удалить</button></div>`).join(""):"<p class='muted'>Пока пусто. Добавь первый предмет.</p>"}
$("addSubject").onclick=async()=>{const name=prompt("Название предмета:");if(!name?.trim())return;db.subjects.push({id:crypto.randomUUID(),name:name.trim(),tickets:[]});await save();render()};
window.deleteSubject=async id=>{const s=db.subjects.find(x=>x.id===id);if(confirm(`Удалить предмет «${s.name}» и все билеты?`)){db.subjects=db.subjects.filter(x=>x.id!==id);await save();render();$("editor").classList.add("hidden");$("study").classList.add("hidden")}};
window.editSubject=id=>{subject=db.subjects.find(x=>x.id===id);$("study").classList.add("hidden");$("editor").classList.remove("hidden");$("editor").innerHTML=`<h2>${esc(subject.name)}</h2>${subject.tickets.map(t=>`<div class="item"><b>${esc(t.title)}</b><div class="muted">${t.parts.length} частей</div><button onclick="editTicket('${t.id}')">Редактировать</button><button class="danger" onclick="deleteTicket('${t.id}')">Удалить</button></div>`).join("")}<button onclick="addTicket()">+ Добавить билет</button>`};
window.addTicket=async()=>{const title=prompt("Название билета или вопроса:");if(!title?.trim())return;subject.tickets.push({id:crypto.randomUUID(),title:title.trim(),parts:[]});await save();editSubject(subject.id)};
window.deleteTicket=async id=>{subject.tickets=subject.tickets.filter(t=>t.id!==id);await save();editSubject(subject.id)};
window.editTicket=id=>{ticket=subject.tickets.find(t=>t.id===id);$("editor").innerHTML=`<h2>${esc(ticket.title)}</h2>${ticket.parts.map((p,i)=>`<div class="item"><b>${esc(p.title)}</b><button onclick="editPart(${i})">Изменить</button></div>`).join("")}<button onclick="editPart(-1)">+ Добавить часть / вопрос</button><button class="secondary" onclick="editSubject(subject.id)">Назад</button>`};
window.editPart=i=>{const p=i<0?{title:"",question:"",options:["","","",""],correct:0,note:""}:ticket.parts[i];let html=`<h2>${i<0?"Новая часть":"Редактирование части"}</h2><label>Название части</label><input id="pt" value="${esc(p.title)}"><label>Вопрос</label><textarea id="pq" rows="3">${esc(p.question)}</textarea><label>Варианты ответов</label>`;for(let n=0;n<4;n++)html+=`<label>Вариант ${n+1}</label><input id="o${n}" value="${esc(p.options[n]||"")}">`;html+=`<label>Номер правильного ответа (1–4)</label><input id="correct" type="number" min="1" max="4" value="${p.correct+1}"><label>Краткий конспект при ошибке</label><textarea id="note" rows="3">${esc(p.note)}</textarea><button id="savePart">Сохранить часть</button><button class="secondary" onclick="editTicket(ticket.id)">Отмена</button>`;$("editor").innerHTML=html;
$("savePart").onclick=async()=>{const options=[];for(let n=0;n<4;n++){const v=$("o"+n).value.trim();if(v)options.push(v)}const correct=Number($("correct").value)-1;if(!$("pt").value.trim()||!$("pq").value.trim()||options.length<2||correct<0||correct>=options.length){alert("Заполни название, вопрос, минимум два варианта и укажи существующий правильный вариант.");return}const item={title:$("pt").value.trim(),question:$("pq").value.trim(),options,correct,note:$("note").value.trim()};if(i<0)ticket.parts.push(item);else ticket.parts[i]=item;await save();editTicket(ticket.id)}};
window.startStudy=(id,random)=>{subject=db.subjects.find(s=>s.id===id);order=subject.tickets.map(t=>t.id);if(random)order.sort(()=>Math.random()-.5);orderPos=0;openTicket()};
function openTicket(){if(orderPos>=order.length){$("study").innerHTML=`<h2>Билеты закончились!</h2><button onclick="editSubject(subject.id)">Вернуться к предмету</button>`;$("study").classList.remove("hidden");return}ticket=subject.tickets.find(t=>t.id===order[orderPos]);partIndex=0;showPart()}
function showPart(){const p=ticket.parts[partIndex],s=$("study");s.classList.remove("hidden");if(!p){s.innerHTML=`<h2>${esc(ticket.title)}</h2><p>В этом билете пока нет частей.</p><button onclick="nextTicket()">Следующий билет</button>`;return}s.innerHTML=`<div class="muted">Билет ${orderPos+1} из ${order.length} · Часть ${partIndex+1} из ${ticket.parts.length}</div><h2>${esc(ticket.title)}</h2><h3>${esc(p.title)}</h3><p>${esc(p.question)}</p><div>${p.options.map((o,i)=>`<button class="option" onclick="answer(${i})">${esc(o)}</button>`).join("")}</div><div id="feedback"></div>`}
window.answer=async n=>{const p=ticket.parts[partIndex],buttons=[...document.querySelectorAll(".option")];buttons.forEach((b,i)=>{b.disabled=true;if(i===p.correct)b.classList.add("correct");if(i===n&&n!==p.correct)b.classList.add("wrong")});const ok=n===p.correct;$("feedback").innerHTML=(ok?"<p>Верно!</p>":`<div class="note"><b>Неверно.</b><br>${esc(p.note||"Повтори эту часть материала.")}</div>`)+`<button onclick="nextPart()">Продолжить</button>`;db.history.push({at:new Date().toISOString(),subject:subject.name,ticket:ticket.title,part:p.title,correct:ok});await save()};
window.nextPart=()=>{if(partIndex<ticket.parts.length-1){partIndex++;showPart()}else nextTicket()};
window.nextTicket=()=>{orderPos++;openTicket()};
$("exportBtn").onclick=()=>{const a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:"application/json"}));a.href=u;a.download="session-trainer-backup.json";a.click();URL.revokeObjectURL(u)};
$("importBtn").onclick=()=>$("file").click();
$("file").onchange=async e=>{try{const x=JSON.parse(await e.target.files[0].text());if(!Array.isArray(x.subjects)||!Array.isArray(x.history))throw Error();if(confirm("Заменить текущие данные содержимым копии?")){db=x;await save();render()}}catch{alert("Не удалось прочитать копию.")}};
</script></body></html>`;

async function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  return Boolean(env.SITE_PASSWORD) && header === "Basic " + btoa("student:" + env.SITE_PASSWORD);
}
async function initialize(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS app_data (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO app_data (id, data, updated_at) VALUES ('main', ?, datetime('now'))")
    .bind(JSON.stringify({subjects:[],history:[]})).run();
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") {
      if (!await authorized(request, env)) return new Response("Unauthorized", {status:401});
      try {
        await initialize(env);
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT data FROM app_data WHERE id='main'").first();
          return Response.json(JSON.parse(row.data));
        }
        if (request.method === "PUT") {
          const data = await request.json();
          if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.history)) return new Response("Bad data", {status:400});
          const serialized = JSON.stringify(data);
          if (serialized.length > 900000) return new Response("Data too large", {status:413});
          await env.DB.prepare("UPDATE app_data SET data=?, updated_at=datetime('now') WHERE id='main'").bind(serialized).run();
          return Response.json({ok:true});
        }
        return new Response("Method not allowed", {status:405});
      } catch (error) { return new Response("Database error: " + error.message, {status:500}); }
    }
    return new Response(PAGE, {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }
};
