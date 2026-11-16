import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { SITE_NAME } from '@/lib/edition'

/**
 * ── MCP APPS: THE LISTING CARDS BOTH eno MCP SERVERS SHOW INSIDE THE CHAT (2026-11-16, owner: "Both servers") ──────────
 *
 * The MCP Apps extension (io.modelcontextprotocol/ui, stable spec 2026-01-26; ChatGPT and Claude both render it): a tool
 * names a `ui://` resource in `_meta.ui.resourceUri`, the host reads that resource (`text/html;profile=mcp-app`) into a
 * sandboxed iframe, and the iframe receives the tool's result over postMessage JSON-RPC (`ui/initialize`, then
 * `ui/notifications/tool-result`). Hosts without MCP Apps ignore all of it: the tools answer exactly as before.
 *
 * ONE PAGE, TWO SERVERS. It renders `structuredContent.listings` (a list) or `structuredContent.listing` (one) as cards,
 * reading both servers' field names (search: image, price_unit; partner: cover / images[0], priceUnit, status).
 *
 * ⛔ SELLER TEXT IS NEVER HTML. Titles and places reach the DOM through `textContent` only; the page has no innerHTML at
 * all (apps.test.ts pins it). A link opens only an https URL on this site (`ui/open-link`), never a seller's.
 * ⛔ NO EXTERNAL SCRIPT: the bridge is hand-rolled below, so the CSP needs no script domain. Images: this site and its
 * storage origin only (`_meta.ui.csp.resourceDomains`); the default MCP Apps CSP blocks every other origin.
 */

export const UI_MIME = 'text/html;profile=mcp-app'
/** Versioned so a changed page is a new URI (hosts cache by URI). */
export const SEARCH_UI_URI = 'ui://eno/search-listings-v1.html'
export const SHOP_UI_URI = 'ui://eno/shop-listings-v1.html'

const SITE_ORIGIN = new URL(OAUTH_ISSUER).origin
const storageOrigin = (() => {
  try { return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null } catch { return null }
})()
const RESOURCE_DOMAINS = [SITE_ORIGIN, ...(storageOrigin && storageOrigin.startsWith('https://') ? [storageOrigin] : [])]

const RESOURCES: Record<string, { name: string; description: string }> = {
  [SEARCH_UI_URI]: { name: `${SITE_NAME} listing cards`, description: 'Shows search results and a listing as cards: photo, title, price in VND, place and a link to the listing page.' },
  [SHOP_UI_URI]: { name: `${SITE_NAME} shop listing cards`, description: 'Shows the shop\'s listings and one listing as cards: photo, title, price in VND, status and a link to the listing page.' },
}

/**
 * The `_meta` a tool carries to name its UI: the MCP Apps key, ChatGPT's alias for the same resource, and the status labels
 * ChatGPT shows while the tool runs and after (flat keys from OpenAI's docs, nested as Manufact's checker reads them).
 */
export function toolUiMeta(uri: string, labels: { invoking: string; invoked: string }) {
  return {
    ui: { resourceUri: uri },
    'openai/outputTemplate': uri,
    'openai/toolInvocation/invoking': labels.invoking,
    'openai/toolInvocation/invoked': labels.invoked,
    'openai/toolInvocation': { invoking: labels.invoking, invoked: labels.invoked },
  }
}

/** `resources/list` entries for the URIs a server serves. */
export function uiResourceList(uris: readonly string[]) {
  return uris.map((uri) => ({ uri, name: RESOURCES[uri].name, description: RESOURCES[uri].description, mimeType: UI_MIME }))
}

/** `resources/read` for one of `uris`; null when the URI is not one of them. */
export function uiResourceRead(uri: unknown, uris: readonly string[]) {
  if (typeof uri !== 'string' || !uris.includes(uri)) return null
  return {
    contents: [{
      uri,
      mimeType: UI_MIME,
      text: listingCardsHtml(),
      // ⚠️ The view's domain goes in ChatGPT's own key, never `ui.domain`: Claude requires its own hashed
      // *.claudemcpcontent.com form there and refuses any other ("Invalid ui.domain format"); ChatGPT reads either and
      // wants one exact https origin for every view of the app (Manufact view-domain-present, 2026-11-16).
      _meta: {
        ui: { csp: { resourceDomains: RESOURCE_DOMAINS, connectDomains: [] }, prefersBorder: true },
        'openai/widgetDomain': SITE_ORIGIN,
        'openai/widgetDescription': RESOURCES[uri].description,
      },
    }],
  }
}

/** The page. Plain HTML + one inline script; strings from the site are JSON-encoded, never spliced as code. */
export function listingCardsHtml(): string {
  const cfg = JSON.stringify({ site: SITE_ORIGIN, siteName: SITE_NAME })
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${SITE_NAME} listings</title>
<style>
:root{--bg:var(--color-background-primary,#fff);--fg:var(--color-text-primary,#1a1a1a);--muted:var(--color-text-secondary,#5f6368);--line:var(--color-border-primary,#e3e3e3);--accent:#d9480f;--radius:var(--border-radius-md,12px);font-family:var(--font-sans,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
:root[data-theme="dark"]{--bg:var(--color-background-primary,#1f1f1f);--fg:var(--color-text-primary,#f1f1f1);--muted:var(--color-text-secondary,#a8a8a8);--line:var(--color-border-primary,#3a3a3a);--accent:#ff8a4c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.4}
.wrap{padding:12px}
.head{font-size:13px;color:var(--muted);margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--bg);cursor:pointer;text-align:left;padding:0;color:inherit;font:inherit}
.card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ph{aspect-ratio:4/3;width:100%;object-fit:cover;background:var(--line);display:block}
.body{padding:8px 10px 10px;display:flex;flex-direction:column;gap:4px}
.title{font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.price{font-weight:700;color:var(--accent)}
.place{color:var(--muted);font-size:12px}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.tag{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.empty{color:var(--muted);padding:8px 0}
</style>
</head>
<body>
<div class="wrap"><p class="head" id="head"></p><div class="grid" id="grid"></div></div>
<script>
(function(){
  var CFG=${cfg};
  var lang='en';
  var T={en:{n:function(k){return k===1?'1 listing':k+' listings'},none:'No listings found.',ad:'Ad',open:'Open on ',failed:'Could not load the listings.',
             per:{month:'month',night:'night',day:'day',week:'week',hour:'hour',year:'year',session:'session',lesson:'lesson',person:'person'},
             st:{sold:'Sold',hidden:'Hidden',expired:'Expired',stale:'Off the site'}},
         vi:{n:function(k){return k+' tin đăng'},none:'Không tìm thấy tin nào.',ad:'Quảng cáo',open:'Mở trên ',failed:'Không tải được tin đăng.',
             per:{month:'tháng',night:'đêm',day:'ngày',week:'tuần',hour:'giờ',year:'năm',session:'buổi',lesson:'buổi học',person:'người'},
             st:{sold:'Đã bán',hidden:'Đã ẩn',expired:'Hết hạn',stale:'Không còn hiển thị'}}};
  var t=function(){return T[lang]||T.en};
  var seq=0,pending={};
  function send(m){window.parent.postMessage(m,'*')}
  function request(method,params){return new Promise(function(res,rej){var id=++seq;pending[id]={res:res,rej:rej};send({jsonrpc:'2.0',id:id,method:method,params:params||{}})})}
  function notify(method,params){send({jsonrpc:'2.0',method:method,params:params||{}})}
  function vnd(n){if(typeof n!=='number'||!isFinite(n)||n<=0)return '';return new Intl.NumberFormat('vi-VN').format(Math.round(n))+' \\u0111'}
  // "VND/month" -> " / month": every unit after the slash is shown, so a nightly or hourly price never reads as a total.
  function per(unit){if(typeof unit!=='string')return '';var i=unit.indexOf('/');if(i<0)return '';var u=unit.slice(i+1).trim().toLowerCase();if(!u)return '';return ' / '+(t().per[u]||u)}
  function onSite(u){try{var x=new URL(u);return x.protocol==='https:'&&x.origin===CFG.site}catch(e){return false}}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e}
  function open(u){if(!onSite(u))return;request('ui/open-link',{url:u}).catch(function(){try{window.open(u,'_blank','noopener')}catch(e){}})}
  var lastResult=null;
  function render(result){
    lastResult=result;
    var sc=(result&&result.structuredContent)||{};
    if(result&&result.isError){
      var msg=t().failed;
      try{var c=result.content&&result.content[0];var j=c&&c.type==='text'?JSON.parse(c.text):null;if(j&&j.error&&typeof j.error.message==='string')msg=j.error.message}catch(e){}
      document.getElementById('head').textContent='';var g=document.getElementById('grid');g.textContent='';g.appendChild(el('p','empty',msg));size();return
    }
    var items=Array.isArray(sc.listings)?sc.listings:(sc.listing&&typeof sc.listing==='object'?[sc.listing]:[]);
    var head=document.getElementById('head'),grid=document.getElementById('grid');
    grid.textContent='';
    head.textContent=items.length?t().n(typeof sc.total==='number'&&sc.total>items.length?sc.total:items.length):'';
    if(!items.length){grid.appendChild(el('p','empty',t().none));size();return}
    items.slice(0,24).forEach(function(it){
      if(!it||typeof it!=='object')return;
      var card=el('button','card');card.type='button';
      var img=it.image||it.cover||(Array.isArray(it.images)?it.images[0]:null);
      if(typeof img==='string'&&/^https:\\/\\//.test(img)){var im=el('img','ph');im.alt='';im.loading='lazy';im.src=img;card.appendChild(im)}
      var b=el('div','body');
      b.appendChild(el('div','title',it.title||''));
      var p=vnd(it.price);if(p)b.appendChild(el('div','price',p+per(it.price_unit||it.priceUnit)));
      var place=[it.district,it.city].filter(function(x){return typeof x==='string'&&x}).join(', ');if(place)b.appendChild(el('div','place',place));
      var tags=el('div','tags');
      if(it.sponsored===true)tags.appendChild(el('span','tag',t().ad));
      if(typeof it.status==='string'&&it.status!=='active')tags.appendChild(el('span','tag',t().st[it.status]||it.status));
      if(tags.childNodes.length)b.appendChild(tags);
      card.appendChild(b);
      if(typeof it.url==='string'&&onSite(it.url)){card.title=t().open+CFG.siteName;card.addEventListener('click',function(){open(it.url)})}
      grid.appendChild(card);
    });
    size();
  }
  function applyContext(c){
    if(!c)return;
    if(c.theme==='dark'||c.theme==='light')document.documentElement.setAttribute('data-theme',c.theme);
    if(typeof c.locale==='string')lang=/^vi/i.test(c.locale)?'vi':'en';
    var v=c.styles&&c.styles.variables;if(v&&typeof v==='object'){for(var k in v){if(/^--[a-z0-9-]+$/i.test(k)&&typeof v[k]==='string')document.documentElement.style.setProperty(k,v[k])}}
  }
  var last=0,ready=false;
  // Nothing is sent to the host before the handshake ends (ui/notifications/initialized); size() runs again right after it.
  function size(){if(!ready)return;var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;notify('ui/notifications/size-changed',{width:Math.ceil(document.documentElement.scrollWidth),height:h})}}
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;var m=e.data;if(!m||m.jsonrpc!=='2.0')return;
    if(m.id!=null&&!m.method&&pending[m.id]){var q=pending[m.id];delete pending[m.id];if(m.error)q.rej(m.error);else q.res(m.result);return}
    if(m.method==='ui/notifications/tool-result'){render(m.params);return}
    // A changed language or theme redraws the last result in it.
    if(m.method==='ui/notifications/host-context-changed'){applyContext(m.params);if(lastResult)render(lastResult);else size();return}
    if((m.method==='ui/resource-teardown'||m.method==='ping')&&m.id!=null){send({jsonrpc:'2.0',id:m.id,result:{}});return}
  });
  if(typeof ResizeObserver==='function')new ResizeObserver(size).observe(document.body);
  request('ui/initialize',{appInfo:{name:CFG.siteName+' listings',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'})
    .then(function(r){applyContext(r&&r.hostContext);notify('ui/notifications/initialized',{});ready=true;size()})
    .catch(function(){notify('ui/notifications/initialized',{});ready=true;size()});
  // ChatGPT's older bridge, when present, holds the result now or announces it later.
  function fromOpenai(){try{if(window.openai&&window.openai.toolOutput)render({structuredContent:window.openai.toolOutput})}catch(e){}}
  fromOpenai();
  window.addEventListener('openai:set_globals',fromOpenai);
})();
</script>
</body>
</html>`
}
