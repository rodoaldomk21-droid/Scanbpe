const $ = s => document.querySelector(s);
const views = ['home','scan','paste','hist','result'];
const KEY = 'bpe_hist_v1';
let reader = null, last = null, lastUrl = '';

function show(id){ views.forEach(v => $('#'+v).hidden = v !== id); if(id!=='home') hideMsg(); }
function hideMsg(){ $('#msg').hidden = true; }
function msg(t, info){ const m=$('#msg'); m.textContent=t; m.className='msg'+(info?' info':''); m.hidden=false; }
function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!==undefined) e.textContent=text; return e; }
function field(label, value){ const d=el('div','f'); d.append(el('span','',label), el('strong','',value||'—')); return d; }

// Conexão
function net(){ const n=$('#net'); n.textContent=navigator.onLine?'Online':'Offline'; n.className='pill'+(navigator.onLine?' ok':' off'); }
addEventListener('online',net); addEventListener('offline',net); net();

// Histórico (somente neste aparelho)
const loadH = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const saveH = a => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(0,50))); } catch {} };
function addH(r, url){
  if(r.consulta.demo) return;
  const a = loadH(); a.unshift({id:Date.now(), url, nome:r.passageiro.nome, origem:r.viagem.origem, destino:r.viagem.destino, data:r.viagem.data, status:r.fiscal.status, em:new Date().toLocaleString('pt-BR')});
  saveH(a);
}
function renderH(){
  const box=$('#histList'); box.replaceChildren();
  const a=loadH();
  if(!a.length){ box.append(el('p','msg info','Nenhuma consulta ainda. Leia um QR Code para começar.')); return; }
  a.forEach(i=>{
    const c=el('div','card');
    c.append(el('strong','',i.nome||'Passageiro não informado'),
      el('div','',`${i.origem||'—'} → ${i.destino||'—'}`),
      el('div','hint',`${i.data||'—'} · ${i.status} · consultado em ${i.em}`));
    const h=el('div','h'), b1=el('button','','Consultar novamente'), b2=el('button','del','Excluir');
    b1.onclick=()=>run(i.url); b2.onclick=()=>{ saveH(loadH().filter(x=>x.id!==i.id)); renderH(); };
    h.append(b1,b2); c.append(h); box.append(c);
  });
}

// Resultado
function render(r){
  const c=$('#resCard'); c.replaceChildren();
  const top=el('div','top'); top.append(el('strong','','BP-e Scanner'));
  top.append(el('span','pill', r.consulta.demo?'Exemplo fictício':'Consulta realizada'));
  c.append(top);

  const ev = r.eventos.find(e=>/N[ÃA]O EMBARQUE/i.test(e.tipo));
  const box=el('div','event '+(ev?'hit':'na'));
  box.append(el('small','','EVENTO IDENTIFICADO'));
  if(ev){ box.append(el('b','',ev.tipo)); if(ev.data) box.append(el('small','',ev.data)); }
  else { box.append(el('b','',BPeService.NA)); }
  c.append(box);

  c.append(field('Passageiro', r.passageiro.nome));
  c.append(field('Origem', r.viagem.origem), el('div','arrow','↓'), field('Destino', r.viagem.destino));
  const g=el('div','grid');
  g.append(field('Data da viagem',r.viagem.data), field('Horário',r.viagem.horario), field('Poltrona',r.viagem.poltrona), field('Tipo de serviço',r.viagem.servico));
  if(r.viagem.linha) c.append(field('Linha', r.viagem.linha));
  c.append(g);
  c.append(field('Status do documento', r.fiscal.status));
  c.append(field('Protocolo do evento', ev ? (ev.status||'Conforme retorno da consulta') : '—'));
  c.append(el('p','note', r.consulta.demo ? 'Dados fictícios, apenas para visualizar o layout.' : 'Somente informações efetivamente disponíveis na consulta pública. Autorização do BPe não confirma embarque.'));
  if(r.consulta.texto && (r.fiscal.status==='STATUS NÃO IDENTIFICADO' || !r.consulta.sucesso)){
    const b=el('button','btn','COPIAR TEXTO LIDO (PARA AJUSTE)'); b.onclick=()=>navigator.clipboard.writeText(r.consulta.texto).then(()=>{b.textContent='Copiado';}); c.append(b);
  }
  $('#btnOfficial').hidden = !lastUrl;
  show('result');
}

async function run(raw){
  stopScan(); lastUrl='';
  show('home'); msg('Consultando…', true);
  const r = await BPeService.consultar(raw);
  if(r._erro){ show('home'); msg(r.consulta.mensagem); return; }
  lastUrl = BPeService.validateUrl(raw).url; last=r; addH(r, lastUrl); render(r);
}

// Câmera / ZXing
async function startScan(){
  if(!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)){ msg('Este navegador não permite usar a câmera. Abra no Safari do iPhone, em HTTPS.'); return; }
  show('scan');
  try{
    reader = new ZXing.BrowserQRCodeReader();
    await reader.decodeFromConstraints({video:{facingMode:'environment'}}, $('#video'), (res)=>{ if(res){ const t=res.getText(); stopScan(); run(t); } });
  }catch(e){
    stopScan(); show('home');
    msg(e && e.name==='NotAllowedError' ? 'Câmera não autorizada. Libere em Ajustes > Safari > Câmera, ou cole o link manualmente.' : 'Não foi possível abrir a câmera. Cole o link manualmente.');
  }
}
function stopScan(){ if(reader){ try{reader.reset();}catch{} reader=null; } }

$('#btnScan').onclick=startScan;
$('#btnStop').onclick=()=>{ stopScan(); show('home'); };
$('#btnPaste').onclick=()=>show('paste');
$('#btnGo').onclick=()=>run($('#url').value);
$('#btnHist').onclick=()=>{ renderH(); show('hist'); };
$('#btnClear').onclick=()=>{ if(confirm('Apagar todo o histórico?')){ saveH([]); renderH(); } };
$('#btnDemo').onclick=()=>{ lastUrl=''; render(BPeService.demo()); };
$('#btnOfficial').onclick=()=>{ if(lastUrl) window.open(lastUrl,'_blank','noopener'); };
document.querySelectorAll('.back').forEach(b=>b.onclick=()=>{ stopScan(); show('home'); });

if('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('sw.js'));
