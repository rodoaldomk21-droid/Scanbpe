// Camada independente de consulta. A integração real (Etapa 2) entra em fetchAndParse().
const BPeService = (() => {
  // Domínios oficiais permitidos. Deixe vazio até confirmarmos o endereço real do QR Code.
  const ALLOWED_DOMAINS = [];

  const STATES = ['AUTORIZADO','CANCELADO','DENEGADO','REJEITADO','NÃO FOI POSSÍVEL CONSULTAR','STATUS NÃO IDENTIFICADO'];
  const NA = 'INFORMAÇÃO NÃO DISPONÍVEL NA CONSULTA PÚBLICA';

  function empty(fonte, mensagem) {
    return { documento:{numero:'',serie:'',chave:''}, passageiro:{nome:''},
      viagem:{origem:'',destino:'',data:'',horario:'',poltrona:'',servico:'',empresa:''},
      fiscal:{status:'NÃO FOI POSSÍVEL CONSULTAR',autorizado:null,cancelado:null},
      eventos:[], consulta:{sucesso:false,mensagem:mensagem||'',fonte:fonte||'',demo:false} };
  }

  function validateUrl(raw) {
    let u;
    try { u = new URL((raw||'').trim()); } catch { return {ok:false,erro:'QR Code sem URL válida ou link inválido.'}; }
    if (u.protocol !== 'https:') return {ok:false,erro:'Somente links HTTPS são aceitos.'};
    if (u.username || u.password) return {ok:false,erro:'Link inválido.'};
    const h = u.hostname.toLowerCase();
    const ok = ALLOWED_DOMAINS.some(d => h === d || h.endsWith('.' + d));
    if (!ok) return {ok:false,erro:'Domínio não autorizado. Envie um exemplo do QR Code para configurarmos o domínio oficial.'};
    return {ok:true,url:u.href};
  }

  // ETAPA 2: acessar a página, extrair campos e eventos (sem inserir HTML externo na interface).
  async function fetchAndParse(url) {
    throw new Error('INTEGRACAO_PENDENTE');
  }

  async function consultar(raw) {
    const v = validateUrl(raw);
    if (!v.ok) return Object.assign(empty('', v.erro), {_erro:true});
    try { return await fetchAndParse(v.url); }
    catch (e) {
      const m = e.message === 'INTEGRACAO_PENDENTE'
        ? 'A integração com a consulta pública ainda não foi implementada (Etapa 2).'
        : 'Falha de conexão ou restrição CORS ao acessar a consulta.';
      return Object.assign(empty(v.url, m), {_erro:true});
    }
  }

  function demo() {
    const r = empty('EXEMPLO FICTÍCIO');
    r.documento = {numero:'000000',serie:'1',chave:''};
    r.passageiro.nome = 'PASSAGEIRO DE EXEMPLO';
    r.viagem = {origem:'RECIFE - PE',destino:'MOSSORÓ - RN',data:'15/07/2026',horario:'18:35',poltrona:'09',servico:'Leito sem ar-condicionado',empresa:''};
    r.fiscal = {status:'AUTORIZADO',autorizado:true,cancelado:false};
    r.eventos = [{tipo:'NÃO EMBARQUE',descricao:'Não embarque',data:'',status:'Conforme retorno da consulta'}];
    r.consulta = {sucesso:true,mensagem:'',fonte:'EXEMPLO FICTÍCIO',demo:true};
    return r;
  }

  return { consultar, validateUrl, demo, NA, STATES };
})();
