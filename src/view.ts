// MCP Apps view: one small self-contained HTML page rendered by the host (claude.ai) in a sandboxed
// iframe. It speaks the MCP Apps postMessage protocol directly (no bundler, no external scripts).
export const VIEW_URI = "ui://hogwarts/card.html";
export const VIEW_MIME = "text/html;profile=mcp-app";
export const VIEW_CSP = { resourceDomains: ["https://static.wikia.nocookie.net"] };

export const VIEW_HTML = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fbf8f1;--fg:#1d1b26;--mut:#6b6679;--card:#fff;--line:#e6dfd0;--gold:#b8862b;--h1:#4b2e83;--h2:#c8923a}
:root[data-theme=dark]{--bg:#12101f;--fg:#f1ecff;--mut:#a39cbd;--card:#1b1830;--line:#2d2950;--gold:#f0c667}
*{box-sizing:border-box}
body{margin:0;padding:10px;background:transparent;color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:10px}
.hero{display:flex;gap:14px;align-items:center;padding:16px;background:linear-gradient(135deg,var(--h1),var(--h2));color:#fff}
.hero img{width:84px;height:84px;border-radius:14px;object-fit:cover;background:#0003;flex:none;border:2px solid #fff6}
.hero .sig{width:84px;height:84px;border-radius:14px;flex:none;display:grid;place-items:center;font-size:40px;background:#0003;border:2px solid #fff6}
.hero h1{margin:0 0 4px;font-size:20px;line-height:1.2}
.sub{opacity:.9;font-size:13px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.b{font-size:11.5px;padding:2px 9px;border-radius:99px;background:#ffffff2b;border:1px solid #fff5;color:#fff}
.body{padding:14px 16px}
.effect{font-size:15px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:max-content 1fr;gap:5px 14px}
.grid dt{color:var(--mut);font-size:12.5px}.grid dd{margin:0;word-break:break-word}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0}
.chip{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid var(--line);background:var(--bg)}
h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:14px 0 6px}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px}
.vs{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;padding:14px 16px;background:linear-gradient(135deg,var(--h1),var(--h2));color:#fff}
.vs .p{text-align:center}.vs img{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #fff8;background:#0003}
.vs .p div{font-weight:600;margin-top:4px;font-size:13px}.vs .x{font-size:22px;opacity:.9}
.src{font-size:11.5px;color:var(--mut);padding:0 16px 12px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;box-shadow:0 0 8px currentColor}
.empty{padding:24px;text-align:center;color:var(--mut)}
</style></head><body>
<div id="root"><div class="empty">✨ Waiting for the owl…</div></div>
<script>
(function(){
var HOUSES={Gryffindor:["#740001","#d3a625"],Slytherin:["#1a472a","#7d8b86"],Ravenclaw:["#0e1a40","#946b2d"],Hufflepuff:["#372e29","#ecb939"]};
var LIGHT={white:"#ffffff",red:"#ff3b3b",scarlet:"#ff2400",blue:"#4aa3ff",green:"#3ddc84",yellow:"#ffe14a",brightyellow:"#ffe14a",gold:"#f0c667",silver:"#c9d1d9",purple:"#a35bff",violet:"#a35bff",orange:"#ff9f43",pink:"#ff7ac6",turquoise:"#2ee6d6",icyblue:"#bfe9ff",fireyorange:"#ff7a1a",blueishwhite:"#d6ecff"};
var root=document.getElementById("root"),nextId=2,pending={};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function add(p,c){if(c)p.appendChild(c);return p}
function send(m){parent.postMessage(Object.assign({jsonrpc:"2.0"},m),"*")}
function request(method,params){return new Promise(function(res){var id=nextId++;pending[id]=res;send({id:id,method:method,params:params})})}
function size(){send({method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}})}
function theme(ctx){if(ctx&&ctx.theme)document.documentElement.setAttribute("data-theme",ctx.theme)}
function colors(h){var c=HOUSES[h];if(c){document.documentElement.style.setProperty("--h1",c[0]);document.documentElement.style.setProperty("--h2",c[1])}}
function link(label,url){var a=el("a",null,label);a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a}
function dl(rows){var d=el("dl","grid");rows.forEach(function(r){if(r[1]==null||r[1]==="")return;add(d,el("dt",null,r[0]));add(d,el("dd",null,Array.isArray(r[1])?r[1].join(", "):String(r[1])))});return d}
function chips(list){var c=el("div","chips");list.forEach(function(x){add(c,el("span","chip",x))});return c}
function img(src,fallback){if(src){var i=el("img");i.src=src;i.alt="";i.referrerPolicy="no-referrer";i.onerror=function(){i.replaceWith(el("div","sig",fallback))};return i}return el("div","sig",fallback)}
function foot(card,d){var s=el("div","src","Source: "+(d.sources||"PotterDB")+" · community data, may be incomplete");if(d.wiki){s.appendChild(document.createTextNode(" · "));s.appendChild(link("Wiki",d.wiki))}card.appendChild(s)}
function hero(d,icon,sub,badges){var h=el("div","hero");add(h,img(d.image,icon));var t=el("div");add(t,el("h1",null,d.name));if(sub)add(t,el("div","sub",sub));var b=el("div","badges");(badges||[]).filter(Boolean).forEach(function(x){add(b,el("span","b",x))});add(t,b);add(h,t);return h}

function character(d){colors(d.house);var c=el("div","card");add(c,hero(d,"🧙",(d.aliases||[]).slice(0,2).join(" · "),[d.house,d.species,d.blood_status,d.gender]));var b=el("div","body");add(b,dl(d.rows||[]));if(d.elixirs&&d.elixirs.length){add(b,el("h2",null,"Elixirs"));add(b,chips(d.elixirs))}add(c,b);foot(c,d);return c}
function spell(d){var c=el("div","card"),lc=LIGHT[String(d.light||"").toLowerCase().replace(/[^a-z]/g,"")];var h=hero(d,"🪄",d.incantation&&d.incantation!==d.name?"“"+d.incantation+"”":"",[d.category]);add(c,h);var b=el("div","body");if(d.effect)add(b,el("p","effect",d.effect));if(d.light&&d.light!=="None"){var l=el("div");l.style.marginBottom="8px";var dot=el("span","dot");dot.style.background=lc||"#ccc";dot.style.color=lc||"#ccc";add(l,dot);add(l,el("span",null,d.light+" light"));add(b,l)}add(b,dl(d.rows||[]));add(c,b);foot(c,d);return c}
function potion(d){var c=el("div","card");add(c,hero(d,"⚗️",d.effect?"":"",[d.difficulty]));var b=el("div","body");if(d.effect)add(b,el("p","effect",d.effect));add(b,dl(d.rows||[]));if(d.ingredients&&d.ingredients.length){add(b,el("h2",null,"Ingredients"));add(b,chips(d.ingredients))}add(c,b);foot(c,d);return c}
function house(d){colors(d.name);var c=el("div","card");add(c,hero({name:d.name,image:null},{Gryffindor:"🦁",Slytherin:"🐍",Ravenclaw:"🦅",Hufflepuff:"🦡"}[d.name]||"🏰",d.info&&d.info.founder?"Founded by "+d.info.founder:"",[d.info&&d.info.colours]));var b=el("div","body");if(d.info){add(b,dl([["Animal",d.info.animal],["Element",d.info.element],["Ghost",d.info.ghost],["Common room",d.info.commonRoom],["Heads",d.info.heads]]));if(d.info.traits&&d.info.traits.length){add(b,el("h2",null,"Traits"));add(b,chips(d.info.traits))}}
 add(b,el("h2",null,"Members ("+d.total+" known)"));var t=el("table"),hd=el("tr");["Name","Species","Blood status"].forEach(function(x){add(hd,el("th",null,x))});add(t,hd);(d.members||[]).forEach(function(m){var r=el("tr");[m.name,m.species,m.blood_status].forEach(function(x){add(r,el("td",null,x||"—"))});add(t,r)});add(b,t);add(c,b);foot(c,d);return c}
function compare(d){var c=el("div","card"),v=el("div","vs");function side(p){var s=el("div","p");add(s,img(p.image,"🧙"));add(s,el("div",null,p.name));return s}add(v,side(d.a));add(v,el("div","x","⚔️"));add(v,side(d.b));add(c,v);var b=el("div","body"),t=el("table"),hd=el("tr");["",d.a.name,d.b.name].forEach(function(x){add(hd,el("th",null,x))});add(t,hd);d.rows.forEach(function(r){var tr=el("tr");r.forEach(function(x,i){var td=el("td",null,x);if(i===0)td.style.color="var(--mut)";add(tr,td)});add(t,tr)});add(b,t);add(c,b);foot(c,d);return c}

function render(d){root.textContent="";var f={character:character,spell:spell,potion:potion,house:house,compare:compare}[d&&d.kind];if(!f){add(root,el("div","empty","Nothing to display."));return}add(root,f(d));setTimeout(size,30)}

window.addEventListener("message",function(e){var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!=null&&pending[m.id]&&(m.result!==undefined||m.error)){var cb=pending[m.id];delete pending[m.id];cb(m.result);return}
 if(m.method==="ui/notifications/tool-result"){var p=m.params||{};if(p.structuredContent)render(p.structuredContent);else add(root,el("div","empty","No visual data for this result."))}
 else if(m.method==="ui/notifications/host-context-changed"){theme(m.params)}
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}})}
});
if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
request("ui/initialize",{appInfo:{name:"hogwarts-card",version:"1.0.0"},appCapabilities:{},protocolVersion:"2026-01-26"}).then(function(r){if(r)theme(r.hostContext);send({method:"ui/notifications/initialized",params:{}});size()});
})();
</script></body></html>`;
