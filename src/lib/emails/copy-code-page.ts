/**
 * THE PAGE BEHIND THE "Copy code" BUTTON OF EMAILS SENT BEFORE 2026-11-06 (owner, 2026-11-04: "add quick copy button"; removed 2026-11-06: "does not copy
 * and takes out of email to browser", layout.ts emailCopyHintRow). Kept only so those links don't 404. ⛔ AN EMAIL CANNOT COPY ANYTHING: mail clients strip every
 * script, so the button is a link to this page, which does the copying.
 *
 * ⛔ THE CODE TRAVELS IN THE URL'S FRAGMENT, WHICH NO SERVER EVER SEES, and is dropped from the address at once. This page is a bare document on purpose: no
 * app shell, no cookies, no analytics that could read the address. textContent only: the fragment is the visitor's to write.
 *
 * Chrome copies on load. Safari and Firefox insist on a tap, so the button stays for them.
 */
const COPY = {
  en: { title: 'Copy your code', copied: 'Code copied', tap: 'Tap to copy your code', button: 'Copy code', again: 'Copy again', back: 'Go back to where you were and paste it.', bad: 'This link has no code in it. Copy the code from the email instead.' },
  vi: { title: 'Sao chép mã', copied: 'Đã sao chép mã', tap: 'Nhấn để sao chép mã', button: 'Sao chép mã', again: 'Sao chép lại', back: 'Quay lại nơi bạn đang thao tác và dán mã vào.', bad: 'Liên kết này không có mã. Hãy sao chép mã trong email.' },
} as const

export function copyCodePage(lang: 'en' | 'vi'): string {
  const c = COPY[lang]
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${c.title}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#f5f6f8;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:400px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px 24px;text-align:center}
h1{margin:0 0 16px;font-size:20px;font-weight:800;letter-spacing:-.01em}
#code{display:inline-block;margin:0 0 20px;padding:14px 22px;background:#f5f6f8;border:1px solid #e5e7eb;border-radius:14px;font:800 30px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:5px;-webkit-user-select:all;user-select:all}
button{display:block;width:100%;min-height:48px;border:0;border-radius:12px;background:#0A66C2;color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer}
p{margin:14px 0 0;font-size:13px;line-height:1.6;color:#6b7280}
[hidden]{display:none!important}
</style></head><body><main>
<h1 id="head">${c.tap}</h1><div id="code"></div><button id="copy" type="button">${c.button}</button><p id="note" hidden>${c.back}</p>
</main>
<script>
(function(){
  var code=(location.hash||'').slice(1),head=document.getElementById('head'),box=document.getElementById('code'),btn=document.getElementById('copy'),note=document.getElementById('note');
  if(history.replaceState)history.replaceState(null,'',location.pathname+location.search);
  if(!/^[0-9]{4,10}$/.test(code)){head.textContent=${JSON.stringify(c.bad)};box.hidden=true;btn.hidden=true;return}
  box.textContent=code;
  function done(){head.textContent=${JSON.stringify(c.copied)};btn.textContent=${JSON.stringify(c.again)};note.hidden=false}
  function copy(){if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(code).then(done);return Promise.reject()}
  copy().catch(function(){});
  btn.addEventListener('click',function(){copy().catch(function(){var r=document.createRange();r.selectNodeContents(box);var s=getSelection();s.removeAllRanges();s.addRange(r)})});
})();
</script></body></html>`
}
