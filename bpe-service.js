// Camada independente de consulta (ETAPA 2: SVRS).
const BPeService = (() => {
  // O endereço do Worker fica em config.js
  const PROXY_URL = (typeof BPE_PROXY_URL !== 'undefined') ? BPE_PROXY_URL : 'https://bpe-proxy.rodoaldomk21.workers.dev';
  const ALLOWED_DOMAINS = ['dfe-portal.svrs.rs.gov.br'];
  const NA = 'INFORMAÇÃO NÃO DISPONÍVEL NA CONSULTA PÚBLICA';

  function empty(fonte, mensagem) {
    return { documento:{numero:'',serie:'',chave:''}, passageiro:{nome:''},
      viagem:{origem:'',destino:'',data:'',horario:'',poltrona:'',servico:'',linha:'',empresa:''},
      fiscal:{status:'NÃO FOI POSSÍVEL CONSULTAR',autorizado:null,cancelado:null},
      eventos:[], consulta:{sucesso:false,mensagem:mensagem||'',fonte:fonte||'',demo:false,texto:''} };
  }

  // Aceita só o QR oficial da SVRS e REMONTA a URL a partir da chave (evita proxy arbitrário/SSRF).
  function validateUrl(raw) {
    let u;
    try { u = new URL((raw||'').trim()); } catch { return {ok:false,erro:'QR Code sem URL válida ou link inválido.'}; }
    if (u.protocol !== 'https:' || u.username || u.password) return {ok:false,erro:'Link inválido. Somente HTTPS é aceito.'};
    const h = u.hostname.toLowerCase();
    if (!ALLOWED_DOMAINS.some(d => h === d || h.endsWith('.' + d))) return {ok:false,erro:'Domínio não autorizado.'};
    const ch = u.searchParams.get('chBPe') || '';
    if (!/^\d{44}$/.test(ch) || u.pathname.toLowerCase() !== '/bpe/qrcode') return {ok:false,erro:'O link não é uma consulta de BPe válida.'};
    const tp = u.searchParams.get('tpAmb') === '2' ? '2' : '1';
    return {ok:true, chave:ch, tpAmb:tp, url:`https://dfe-portal.svrs.rs.gov.br/bpe/qrCode?chBPe=${ch}&tpAmb=${tp}`};
  }

  function toLines(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html'); // não executa scripts
    doc.querySelectorAll('script,style,noscript').forEach(e => e.remove());
    doc.querySelectorAll('br,div,p,tr,li,h1,h2,h3,h4,table,section').forEach(e => e.append('\n'));
    return doc.body.textContent.split('\n').map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean);
  }
  const after = (lines, label) => { const i = lines.findIndex(l => new RegExp('^'+label+':?$','i').test(l)); return i>=0 ? (lines[i+1]||'') : ''; };

  const fdt = iso => { const m=(iso||'').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}(?::\d{2})?)/); return m?{d:`${m[3]}/${m[2]}/${m[1]}`,t:m[4]}:{d:'',t:''}; };
  function parseXml(html, v) {
    const x = new DOMParser().parseFromString(html, 'text/xml');
    const g = (tag, ctx) => { const e=(ctx||x).getElementsByTagNameNS('*',tag)[0]; return e?e.textContent.trim():''; };
    const r = empty(v.url); r.documento.chave=v.chave; r.documento.numero=g('nBP'); r.documento.serie=g('serie');
    const pa = x.getElementsByTagNameNS('*','infPassagem')[0];
    if (pa) r.passageiro.nome = g('xNome', pa);
    r.viagem.origem=g('xLocOrig'); r.viagem.destino=g('xLocDest'); r.viagem.poltrona=g('poltrona'); r.viagem.linha=g('xPercurso');
    const dv=fdt(g('dhViagem')); r.viagem.data=dv.d; r.viagem.horario=dv.t.slice(0,5);
    const cs=g('cStat', x.getElementsByTagNameNS('*','infProt')[0]);
    const map={'100':'AUTORIZADO','101':'CANCELADO','110':'DENEGADO'};
    r.fiscal.status = map[cs] || 'STATUS NÃO IDENTIFICADO';
    if (map[cs]) { r.fiscal.autorizado = cs==='100'; r.fiscal.cancelado = cs==='101'; }
    [...x.getElementsByTagNameNS('*','infEvento')].forEach(e => {
      const d=fdt(g('dhRegEvento',e));
      r.eventos.push({tipo:g('descEvento',e).toUpperCase(), descricao:g('descEvento',e), data:d.d?`${d.d} às ${d.t}`:'', status:g('nProt',e)?`Protocolo ${g('nProt',e)}`:''});
    });
    r.consulta.sucesso = !!(r.viagem.origem || r.documento.numero);
    return r;
  }


  // Eventos: linha "dd/mm/aaaa às hh:mm:ss-03:00 - Protocolo: N", com o título em maiúsculas logo acima.
  function evFromLines(lines) {
    const out = [];
    lines.forEach((l, i) => {
      const m = l.match(/^(?:Chave:\s*(\d{44})\s*)?(\d{2}\/\d{2}\/\d{4}) [àa]s (\d{2}:\d{2}:\d{2})\S*\s*-\s*Protocolo:\s*(\d+)/i);
      if (!m) return;
      let chave = m[1] || '', tipo = '';
      for (let k = i - 1; k >= Math.max(0, i - 5); k--) {
        const c = lines[k].match(/^(?:Chave:\s*)?(\d{44})$/i) || lines[k].match(/^Chave:\s*(\d{44})/i);
        if (c) { chave = chave || c[1]; continue; }
        if (/^Chave:?$/i.test(lines[k])) continue;
        if (/^[A-ZÀ-Ú][A-ZÀ-Ú ]{4,}$/.test(lines[k])) { tipo = lines[k]; break; }
      }
      if (tipo) out.push({tipo, descricao:tipo, data:`${m[2]} às ${m[3]}`, status:`Protocolo ${m[4]}`, chave});
    });
    return out;
  }
  function pasFromFlat(flat) {
    const m = flat.match(/Passageiro:\s*RG\s*[\w.\-]*\s+-\s+(.+?)\s+Tipo de desconto/i);
    return m ? m[1].trim() : '';
  }

  function parse(html, v, j) {
    j = j || {};
    const diag = `HTTP ${j.status} | ${j.ct} | ${j.len} bytes | ` + (html||'').replace(/\s+/g,' ').slice(0,3000);
    if (/<\?xml|<bpeProc|<BPe[ >]/i.test((html||'').slice(0,3000))) {
      const rx = parseXml(html, v); rx.consulta.diag = diag; if (!rx.consulta.sucesso) rx.consulta.mensagem='Dados não encontrados na resposta.'; return rx;
    }
    const lines = toLines(html), flat = lines.join(' ');
    const r = empty(v.url);
    r.documento.chave = v.chave;
    r.documento.serie = String(parseInt(v.chave.slice(22,25),10));
    r.documento.numero = String(parseInt(v.chave.slice(25,34),10));
    r.consulta.texto = lines.join('\n');

    r.eventos = evFromLines(lines);

    const places = [...flat.matchAll(/([A-ZÀ-Ú][A-ZÀ-Ú' ]+ - [A-Z]{2}) \([A-Z]{2}\)/g)].map(m => m[1].trim());
    if (places[0]) r.viagem.origem = places[0];
    if (places[1]) r.viagem.destino = places[1];
    const dt = flat.match(/Data e hor[áa]rio:?\s*(\d{2}\/\d{2}\/\d{4})\s*[àa]s\s*(\d{2}:\d{2})/i);
    if (dt) { r.viagem.data = dt[1]; r.viagem.horario = dt[2]; }
    const pol = flat.match(/Poltrona:?\s*(\w+)/i); if (pol) r.viagem.poltrona = pol[1];
    r.viagem.servico = after(lines,'Tipo'); r.viagem.linha = after(lines,'Linha');
    const pm = pasFromFlat(flat); if (pm) r.passageiro.nome = pm;
    const pas = !r.passageiro.nome && lines.find(l => /^Passageiro:?\s*\S/i.test(l) && !/RG$/i.test(l)); if (pas) r.passageiro.nome = pas.replace(/^Passageiro:?\s*/i,'');
    if (!r.passageiro.nome) { const i=lines.findIndex(l=>/^Passageiro:?\s*RG/i.test(l)); const n=i>=0?lines.slice(i,i+4).find(l=>/^- \S/.test(l)):''; if (n) r.passageiro.nome=n.replace(/^- /,''); }

    const st = flat.match(/Situa[çc][ãa]o[^A-Za-z]{0,8}(AUTORIZAD|CANCELAD|DENEGAD|REJEITAD)/i);
    if (st) {
      const k = st[1].toUpperCase(); r.fiscal.status = k + 'O';
      r.fiscal.autorizado = k==='AUTORIZAD'; r.fiscal.cancelado = k==='CANCELAD';
    } else if (/Protocolo de Autoriza[çc][ãa]o:?\s*\d+/i.test(flat) && !r.eventos.some(e=>/CANCEL/i.test(e.tipo)) && !/cancelad/i.test(flat)) {
      r.fiscal.status='AUTORIZADO'; r.fiscal.autorizado=true; r.fiscal.cancelado=false;
    } else r.fiscal.status = 'STATUS NÃO IDENTIFICADO';

    r.consulta.diag = diag; r.consulta.sucesso = !!(r.viagem.origem || r.eventos.length);
    if (!r.consulta.sucesso) r.consulta.mensagem = 'Dados não encontrados na página consultada.';
    return r;
  }

  async function fetchAndParse(v) {
    if (!PROXY_URL) throw new Error('PROXY_PENDENTE');
    const res = await fetch(`${PROXY_URL}?chBPe=${v.chave}&tpAmb=${v.tpAmb}`);
    const j = await res.json();
    if (j.captcha) return Object.assign(empty(v.url,'A consulta automatizada foi bloqueada (CAPTCHA/proteção). Use "Abrir consulta oficial".'),{_erro:true});
    if (!j.ok) throw new Error('PAGINA_FORA');
    return parse(j.html, v, j);
  }

  async function consultar(raw) {
    const v = validateUrl(raw);
    if (!v.ok) return Object.assign(empty('', v.erro), {_erro:true});
    try { return await fetchAndParse(v); }
    catch (e) {
      const m = e.message==='PROXY_PENDENTE' ? 'Falta configurar o endereço do proxy (PROXY_URL em bpe-service.js).'
        : e.message==='PAGINA_FORA' ? 'A página de consulta está fora do ar ou recusou o acesso.'
        : 'Falha de conexão com o proxy ou com a consulta.';
      return Object.assign(empty(v.url, m), {_erro:true});
    }
  }

  function demo() {
    const r = empty('EXEMPLO FICTÍCIO');
    r.passageiro.nome = 'PASSAGEIRO DE EXEMPLO';
    r.viagem = {origem:'RECIFE - PE',destino:'MOSSORÓ - RN',data:'15/07/2026',horario:'18:35',poltrona:'09',servico:'Leito sem ar-condicionado',linha:'',empresa:''};
    r.fiscal = {status:'AUTORIZADO',autorizado:true,cancelado:false};
    r.eventos = [{tipo:'NÃO EMBARQUE',descricao:'Não embarque',data:'',status:'Conforme retorno da consulta'}];
    r.consulta = {sucesso:true,mensagem:'',fonte:'EXEMPLO FICTÍCIO',demo:true,texto:''};
    return r;
  }
  return { consultar, validateUrl, demo, NA, _t:{evFromLines,pasFromFlat} };
})();
