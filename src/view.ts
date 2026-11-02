// MCP Apps view: one small self-contained HTML page rendered by the host (claude.ai) in a sandboxed
// iframe. It speaks the MCP Apps postMessage protocol directly (no bundler, no external scripts).
// Besides rendering the tool result, it can call tools back through the host (pagination, "another",
// opening a character from a list) and keeps a small back stack.
export const VIEW_URI = "ui://hogwarts/card.html";
export const VIEW_MIME = "text/html;profile=mcp-app";
export const VIEW_CSP = { resourceDomains: ["https://static.wikia.nocookie.net", "https://www.wizardingworld.com", "https://covers.openlibrary.org", "https://archive.org", "https://*.archive.org"] };

export const VIEW_HTML = /* html */ String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fbf8f1;--fg:#1d1b26;--mut:#6b6679;--card:#fff;--line:#e6dfd0;--gold:#b8862b;--h1:#4b2e83;--h2:#c8923a}
:root[data-theme=dark]{--bg:#12101f;--fg:#f1ecff;--mut:#a39cbd;--card:#1b1830;--line:#2d2950;--gold:#f0c667}
*{box-sizing:border-box}
body{margin:0;padding:10px;background:transparent;color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:10px}
.busy{opacity:.55;pointer-events:none}
.hero{display:flex;gap:14px;align-items:center;padding:16px;background:linear-gradient(135deg,var(--h1),var(--h2));color:#fff}
.hero img{width:84px;height:84px;border-radius:14px;object-fit:cover;background:#0003;flex:none;border:2px solid #fff6}
.sig{width:84px;height:84px;border-radius:14px;flex:none;display:grid;place-items:center;font-size:40px;background:#0003;border:2px solid #fff6}
.sig.mini{width:44px;height:44px;font-size:22px;border-radius:10px;border:1px solid var(--line);background:var(--bg)}
.hero h1{margin:0 0 4px;font-size:20px;line-height:1.2}
.sub{opacity:.9;font-size:13px}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.b{font-size:11.5px;padding:2px 9px;border-radius:99px;background:#ffffff2b;border:1px solid #fff5;color:#fff}
.body{padding:14px 16px}
.effect{font-size:15px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:max-content 1fr;gap:5px 14px}
.grid dt{color:var(--mut);font-size:12.5px}.grid dd{margin:0;word-break:break-word}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0}
.chip{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-family:inherit}
.chip.link{cursor:pointer}.chip.link:hover{border-color:var(--gold)}
.chip small{color:var(--mut);margin-left:4px}
h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:14px 0 6px}
a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px}
tr.go{cursor:pointer}tr.go:hover td{background:var(--bg)}
.vs{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;padding:14px 16px;background:linear-gradient(135deg,var(--h1),var(--h2));color:#fff}
.vs .p{text-align:center}.vs img{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #fff8;background:#0003}
.vs .sig{width:64px;height:64px;border-radius:50%;margin:0 auto;font-size:30px}
.vs .p div.n{font-weight:600;margin-top:4px;font-size:13px}.vs .x{font-size:22px;opacity:.9}
.src{font-size:11.5px;color:var(--mut);padding:0 16px 12px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;box-shadow:0 0 8px currentColor}
.empty{padding:24px;text-align:center;color:var(--mut)}
.row{display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line)}
.row.go{cursor:pointer}.row.go:hover{background:var(--bg)}
.row img{width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none;background:var(--bg)}
.row .t{font-weight:600}.row .s{color:var(--mut);font-size:12.5px}
.bar{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 16px}
.btn{font:inherit;font-size:13px;padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
.btn:hover:not(:disabled){border-color:var(--gold)}.btn:disabled{opacity:.4;cursor:default}
.back{margin:0 0 8px}
.note{padding:0 16px 10px;color:var(--mut);font-size:12.5px}
pre.txt{white-space:pre-wrap;font:inherit;margin:0}
.tree{overflow:auto;padding:4px 12px 12px}
.tree svg{display:block}
.ed{fill:none;stroke:var(--mut);stroke-opacity:.55;stroke-width:1.5}
.ed.m{stroke:var(--gold);stroke-opacity:1;stroke-width:2.5}
.ed.x{stroke-dasharray:4 4;stroke-opacity:.35}
.nd{cursor:pointer;outline:none}
.nd rect.bx{fill:var(--bg);stroke:var(--line);stroke-width:1.2}
.nd:hover rect.bx,.nd:focus rect.bx{stroke:var(--gold)}
.nd.me rect.bx{fill:var(--card);stroke:var(--gold);stroke-width:2.5}
.nd.dead text{opacity:.7}
.nd text{fill:var(--fg);font-size:11.5px;text-anchor:middle;pointer-events:none}
</style></head><body>
<div id="root"><div class="empty">✨ Waiting for the owl…</div></div>
<script>
(function(){
var HOUSES={Gryffindor:["#740001","#d3a625"],Slytherin:["#1a472a","#7d8b86"],Ravenclaw:["#0e1a40","#946b2d"],Hufflepuff:["#372e29","#ecb939"]};
var LIGHT={white:"#ffffff",red:"#ff3b3b",scarlet:"#ff2400",blue:"#4aa3ff",green:"#3ddc84",yellow:"#ffe14a",brightyellow:"#ffe14a",gold:"#f0c667",silver:"#c9d1d9",purple:"#a35bff",violet:"#a35bff",orange:"#ff9f43",pink:"#ff7ac6",turquoise:"#2ee6d6",icyblue:"#bfe9ff",fireyorange:"#ff7a1a",blueishwhite:"#d6ecff"};
var root=document.getElementById("root"),nextId=2,pending={},stack=[],cur=null,busy=false;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function add(p,c){if(c)p.appendChild(c);return p}
function send(m){parent.postMessage(Object.assign({jsonrpc:"2.0"},m),"*")}
function request(method,params){return new Promise(function(res,rej){var id=nextId++;pending[id]={res:res,rej:rej};send({id:id,method:method,params:params})})}
function size(){send({method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}})}
function theme(ctx){if(ctx&&ctx.theme)document.documentElement.setAttribute("data-theme",ctx.theme)}
function colors(h){var c=HOUSES[h]||["#4b2e83","#c8923a"];document.documentElement.style.setProperty("--h1",c[0]);document.documentElement.style.setProperty("--h2",c[1])}
function link(label,url){var a=el("a",null,label);a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a}
function dl(rows){var d=el("dl","grid");(rows||[]).forEach(function(r){if(r[1]==null||r[1]==="")return;add(d,el("dt",null,r[0]));add(d,el("dd",null,Array.isArray(r[1])?r[1].join(", "):String(r[1])))});return d}
function chips(list){var c=el("div","chips");list.forEach(function(x){add(c,el("span","chip",x))});return c}
function img(src,fallback,cls){if(src){var i=el("img");i.src=src;i.alt="";i.referrerPolicy="no-referrer";i.onerror=function(){i.replaceWith(el("div","sig"+(cls?" "+cls:""),fallback))};return i}return el("div","sig"+(cls?" "+cls:""),fallback)}
function foot(card,d){var s=el("div","src","Source: "+(d.sources||"PotterDB")+" · community data, may be incomplete");if(d.wiki){s.appendChild(document.createTextNode(" · "));s.appendChild(link("Wiki",d.wiki))}card.appendChild(s)}
function hero(d,icon,sub,badges){var h=el("div","hero");if(icon!==null)add(h,img(d.image,icon));var t=el("div");add(t,el("h1",null,d.name||d.title));if(sub)add(t,el("div","sub",sub));var b=el("div","badges");(badges||[]).filter(Boolean).forEach(function(x){add(b,el("span","b",x))});add(t,b);add(h,t);return h}
function btn(label,fn,disabled){var b=el("button","btn",label);b.type="button";if(disabled)b.disabled=true;b.addEventListener("click",fn);return b}
function clickable(node,call){node.classList.add("go");node.tabIndex=0;node.setAttribute("role","button");node.addEventListener("click",function(){go(call,true)});node.addEventListener("keydown",function(e){if(e.key==="Enter")go(call,true)})}
function pager(card,d){var n=d.nav;if(!n||!(n.pages>1))return;var bar=el("div","bar");add(bar,btn("← Prev",function(){go({name:n.name,arguments:Object.assign({},n.arguments,{page:n.page-1})},false)},n.page<=1));add(bar,el("span","sub","Page "+n.page+" of "+n.pages+(d.total?" · "+d.total+" results":"")));add(bar,btn("Next →",function(){go({name:n.name,arguments:Object.assign({},n.arguments,{page:n.page+1})},false)},n.page>=n.pages));card.appendChild(bar)}
function actions(card,d){if(!d.again&&!d.family)return;var bar=el("div","bar");var l=el("div");if(d.again)add(l,btn("🎲 Another",function(){go(d.again,false)}));if(d.family){l.appendChild(document.createTextNode(" "));add(l,btn("🌳 Family tree",function(){go(d.family,true)}))}bar.appendChild(l);card.appendChild(bar)}

function character(d){colors(d.house);var c=el("div","card");add(c,hero(d,"🧙",(d.aliases||[]).slice(0,2).join(" · "),[d.house,d.species,d.blood_status,d.gender]));var b=el("div","body");add(b,dl(d.rows));if(d.elixirs&&d.elixirs.length){add(b,el("h2",null,"Elixirs"));add(b,chips(d.elixirs))}add(c,b);actions(c,d);foot(c,d);return c}
function spell(d){colors();var c=el("div","card"),lc=LIGHT[String(d.light||"").toLowerCase().replace(/[^a-z]/g,"")];add(c,hero(d,"🪄",d.incantation&&d.incantation!==d.name?"“"+d.incantation+"”":"",[d.category]));var b=el("div","body");if(d.effect)add(b,el("p","effect",d.effect));if(d.light&&d.light!=="None"){var l=el("div");l.style.marginBottom="8px";var dot=el("span","dot");dot.style.background=lc||"#ccc";dot.style.color=lc||"#ccc";add(l,dot);add(l,el("span",null,d.light+" light"));add(b,l)}add(b,dl(d.rows));add(c,b);actions(c,d);foot(c,d);return c}
function potion(d){colors();var c=el("div","card");add(c,hero(d,"⚗️","",[d.difficulty]));var b=el("div","body");if(d.effect)add(b,el("p","effect",d.effect));add(b,dl(d.rows));if(d.ingredients&&d.ingredients.length){add(b,el("h2",null,"Ingredients"));add(b,chips(d.ingredients))}add(c,b);foot(c,d);return c}
function house(d){colors(d.name);var c=el("div","card");add(c,hero({name:d.name,image:null},{Gryffindor:"🦁",Slytherin:"🐍",Ravenclaw:"🦅",Hufflepuff:"🦡"}[d.name]||"🏰",d.info&&d.info.founder?"Founded by "+d.info.founder:"",[d.info&&d.info.colours]));var b=el("div","body");if(d.info){add(b,dl([["Animal",d.info.animal],["Element",d.info.element],["Ghost",d.info.ghost],["Common room",d.info.commonRoom],["Heads",d.info.heads]]));if(d.info.traits&&d.info.traits.length){add(b,el("h2",null,"Traits"));add(b,chips(d.info.traits))}}
 add(b,el("h2",null,"Members ("+d.total+" known)"));var t=el("table"),hd=el("tr");["Name","Species","Blood status"].forEach(function(x){add(hd,el("th",null,x))});add(t,hd);(d.members||[]).forEach(function(m){var r=el("tr");[m.name,m.species,m.blood_status].forEach(function(x){add(r,el("td",null,x||"—"))});if(m.slug)clickable(r,{name:"get_character",arguments:{name_or_slug:m.slug}});add(t,r)});add(b,t);add(c,b);pager(c,d);foot(c,d);return c}
function compare(d){colors();var c=el("div","card"),v=el("div","vs");function side(p){var s=el("div","p");add(s,img(p.image,"🧙"));add(s,el("div","n",p.name));return s}add(v,side(d.a));add(v,el("div","x","⚔️"));add(v,side(d.b));add(c,v);var b=el("div","body"),t=el("table"),hd=el("tr");["",d.a.name,d.b.name].forEach(function(x){add(hd,el("th",null,x))});add(t,hd);d.rows.forEach(function(r){var tr=el("tr");r.forEach(function(x,i){var td=el("td",null,x);if(i===0)td.style.color="var(--mut)";add(tr,td)});add(t,tr)});add(b,t);add(c,b);foot(c,d);return c}
function list(d){colors();var c=el("div","card");add(c,hero({name:d.title,image:null},null,d.sub||""));var sec=null;(d.items||[]).forEach(function(it){if(it.section&&it.section!==sec){sec=it.section;add(c,el("h2",null,sec))}var r=el("div","row");add(r,img(it.image,it.icon||"✨","mini"));var t=el("div");var tt=el("div","t");if(it.url)add(tt,link(it.title,it.url));else tt.textContent=it.title;add(t,tt);if(it.sub)add(t,el("div","s",it.sub));add(r,t);if(it.call)clickable(r,it.call);add(c,r)});if(d.note)add(c,el("div","note",d.note));pager(c,d);foot(c,d);return c}
function detail(d){colors();var c=el("div","card");add(c,hero(d,d.icon||"📖",d.subtitle||"",d.badges));var b=el("div","body");if(d.summary)add(b,el("p","effect",d.summary));add(b,dl(d.rows));if(d.chips&&d.chips.length){add(b,el("h2",null,d.chipsLabel||""));add(b,chips(d.chips))}if(d.links&&d.links.length){var l=el("div");l.style.marginTop="10px";d.links.forEach(function(x,i){if(i)l.appendChild(document.createTextNode(" · "));add(l,link(x.label,x.url))});add(b,l)}add(c,b);foot(c,d);return c}
function status(d){colors();var c=el("div","card");add(c,hero({name:"Sources",image:null},null,"Upstream APIs this server relies on"));(d.rows||[]).forEach(function(r){var row=el("div","row"),dot=el("span","dot");dot.style.background=r.ok?"#3ddc84":"#ff4d4d";dot.style.color=dot.style.background;add(row,dot);var t=el("div");add(t,el("div","t",r.name));add(t,el("div","s",r.status+" · "+r.latency));add(row,t);add(c,row)});if(d.note)add(c,el("div","note",d.note));return c}
function family(d){colors(d.house);var c=el("div","card");add(c,hero(d,"🌳","Family",[d.house]));var b=el("div","body");(d.groups||[]).forEach(function(g){add(b,el("h2",null,g.label));var cs=el("div","chips");g.members.forEach(function(m){var ch=el("button","chip link",(m.dead?"† ":"")+m.name);ch.type="button";if(m.relation&&m.relation.toLowerCase()!==m.name.toLowerCase()){add(ch,el("small",null,m.relation))}ch.addEventListener("click",function(){go({name:"get_character",arguments:{name_or_slug:m.name}},true)});add(cs,ch)});add(b,cs)});if(!(d.groups||[]).length)add(b,el("div","empty","No family recorded."));add(c,b);if(d.tree){var tb=el("div","bar");add(tb,btn("🕸️ Full graphical tree",function(){go(d.tree,true)}));c.appendChild(tb)}foot(c,d);return c}
var SVGNS="http://www.w3.org/2000/svg";
function sv(t,a,p){var e=document.createElementNS(SVGNS,t);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
function wrap(s,n){var l=[""];s.split(" ").forEach(function(x){var c=l[l.length-1];if(!c)l[l.length-1]=x;else if((c+" "+x).length<=n)l[l.length-1]=c+" "+x;else l.push(x)});if(l.length>2)l=[l[0],l.slice(1).join(" ")];return l.map(function(x){return x.length>n?x.slice(0,n-1)+"…":x})}
function tree(d){colors(d.house);var c=el("div","card");add(c,hero({name:d.name,image:d.image},"🕸️","Family tree · "+(d.nodes||[]).length+" people",[d.house]));
 var nodes=d.nodes||[],edges=d.edges||[],by={},gens={},mate={},par={},pos={};
 nodes.forEach(function(n){by[n.id]=n;(gens[n.gen]=gens[n.gen]||[]).push(n)});
 edges.forEach(function(e){if(e[2]==="m"){(mate[e[0]]=mate[e[0]]||[]).push(e[1]);(mate[e[1]]=mate[e[1]]||[]).push(e[0])}else if(e[2]==="p"){(par[e[1]]=par[e[1]]||[]).push(e[0])}});
 var keys=Object.keys(gens).map(Number).sort(function(a,b){return a-b});
 var W=128,H=44,GX=14,GU=26,GY=56,PAD=12;
 keys.forEach(function(g,ri){var seen={},units=[],y=PAD+ri*(H+GY);
  gens[g].forEach(function(n){if(seen[n.id])return;seen[n.id]=1;var u=[n];(mate[n.id]||[]).forEach(function(m){var mn=by[m];if(mn&&mn.gen===g&&!seen[m]){seen[m]=1;u.push(mn)}});units.push(u)});
  units.forEach(function(u){var xs=[];u.forEach(function(n){(par[n.id]||[]).forEach(function(p){if(pos[p])xs.push(pos[p].x+W/2)})});u.bc=xs.length?xs.reduce(function(a,b){return a+b},0)/xs.length:null});
  var known=units.filter(function(u){return u.bc!=null}).sort(function(a,b){return a.bc-b.bc}),rest=units.filter(function(u){return u.bc==null}),prev=PAD;
  known.concat(rest).forEach(function(u){var uw=u.length*W+(u.length-1)*GX,left=u.bc!=null?Math.max(prev,u.bc-uw/2):prev;u.forEach(function(n,i){pos[n.id]={x:left+i*(W+GX),y:y}});prev=left+uw+GU})});
 var minX=1e9,maxX=0,maxY=0;nodes.forEach(function(n){var p=pos[n.id];if(!p)return;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x+W);maxY=Math.max(maxY,p.y+H)});
 var sh=PAD-minX;nodes.forEach(function(n){if(pos[n.id])pos[n.id].x+=sh});
 var TW=maxX+sh+PAD,TH=maxY+PAD,sc=Math.max(.6,Math.min(1,(document.body.clientWidth-40)/TW));
 var svg=sv("svg",{viewBox:"0 0 "+TW+" "+TH});
 function apply(){svg.setAttribute("width",Math.round(TW*sc));svg.setAttribute("height",Math.round(TH*sc))}apply();
 edges.forEach(function(e){var a=pos[e[0]],b=pos[e[1]];if(!a||!b)return;
  if(e[2]==="p"){var x1=a.x+W/2,y1=a.y+H,x2=b.x+W/2,y2=b.y;sv("path",{d:"M"+x1+" "+y1+"C"+x1+" "+(y1+GY/2)+" "+x2+" "+(y2-GY/2)+" "+x2+" "+y2,class:"ed"},svg)}
  else if(e[2]==="m"){if(a.y===b.y){var l=a.x<b.x?a:b,r=a.x<b.x?b:a;sv("line",{x1:l.x+W,y1:l.y+H/2,x2:r.x,y2:r.y+H/2,class:"ed m"},svg)}else sv("line",{x1:a.x+W/2,y1:a.y+H/2,x2:b.x+W/2,y2:b.y+H/2,class:"ed m"},svg)}
  else sv("line",{x1:a.x+W/2,y1:a.y+H/2,x2:b.x+W/2,y2:b.y+H/2,class:"ed x"},svg)});
 nodes.forEach(function(n){var p=pos[n.id];if(!p)return;var g=sv("g",{class:"nd"+(n.center?" me":"")+(n.dead?" dead":""),transform:"translate("+p.x+" "+p.y+")",tabindex:0,role:"button"},svg);
  sv("rect",{width:W,height:H,rx:10,class:"bx"},g);var hc=HOUSES[n.house];if(hc)sv("rect",{width:6,height:H,rx:3,fill:hc[0]},g);
  var t=wrap((n.dead?"† ":"")+n.name,17);t.forEach(function(s,i){var tx=sv("text",{x:W/2+3,y:t.length===1?H/2+4:H/2-3+i*14},g);tx.textContent=s});
  sv("title",{},g).textContent=n.name+(n.dead?" (deceased)":"");
  function open(){if(!n.center)go({name:"get_character",arguments:{name_or_slug:n.slug||n.name}},true)}
  g.addEventListener("click",open);g.addEventListener("keydown",function(e){if(e.key==="Enter")open()})});
 var bar=el("div","bar"),zl=el("div");add(zl,btn("−",function(){sc=Math.max(.3,sc-.15);apply()}));zl.appendChild(document.createTextNode(" "));add(zl,btn("+",function(){sc=Math.min(1.6,sc+.15);apply()}));zl.appendChild(document.createTextNode(" "));add(zl,btn("Fit",function(){sc=Math.max(.15,Math.min(1.6,(document.body.clientWidth-40)/TW));apply()}));add(bar,zl);add(bar,el("span","sub","Click a name to open it · † deceased"));add(c,bar);
 var wr=el("div","tree");wr.appendChild(svg);add(c,wr);if(d.note)add(c,el("div","note",d.note));foot(c,d);return c}
function plain(d){var c=el("div","card"),b=el("div","body");add(b,el("pre","txt",d.text));add(c,b);return c}

var KINDS={character:character,spell:spell,potion:potion,house:house,compare:compare,list:list,detail:detail,status:status,family:family,tree:tree,text:plain};
function draw(){root.textContent="";if(stack.length){var bk=btn("← Back",function(){show(stack.pop(),false)});bk.classList.add("back");add(root,bk)}var f=KINDS[cur&&cur.kind];if(!f){add(root,el("div","empty","Nothing to display."));return}add(root,f(cur));setTimeout(size,30)}
function show(d,push){if(push&&cur)stack.push(cur);cur=d;draw()}
function textOf(r){return((r&&r.content)||[]).map(function(c){return c.text||""}).join("\n")}
function go(call,push){if(busy)return;busy=true;document.body.classList.add("busy");
 request("tools/call",call).then(function(r){busy=false;document.body.classList.remove("busy");var d=r&&r.structuredContent;if(!d||r.isError)d={kind:"text",text:textOf(r)||"No result."};show(d,push)},function(e){busy=false;document.body.classList.remove("busy");show({kind:"text",text:"Could not load: "+(e&&e.message||"error")},push)})}

window.addEventListener("message",function(e){var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!=null&&pending[m.id]&&(m.result!==undefined||m.error)){var p=pending[m.id];delete pending[m.id];if(m.error)p.rej(m.error);else p.res(m.result);return}
 if(m.method==="ui/notifications/tool-result"){var r=m.params||{};stack=[];show(r.structuredContent||{kind:"text",text:textOf(r)||"No visual data for this result."},false)}
 else if(m.method==="ui/notifications/host-context-changed"){theme(m.params)}
 else if(m.method==="ui/resource-teardown"&&m.id!=null){send({id:m.id,result:{}})}
});
if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
request("ui/initialize",{appInfo:{name:"hogwarts-card",version:"1.1.0"},appCapabilities:{},protocolVersion:"2026-01-26"}).then(function(r){if(r)theme(r.hostContext);send({method:"ui/notifications/initialized",params:{}});size()},function(){});
})();
</script></body></html>`;
