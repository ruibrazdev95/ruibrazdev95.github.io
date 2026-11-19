import * as core from './core.js';

const CONFIG = {
  apiKey: 'AIzaSyAoCqvNMzehxSP0a1yKf_LqvvNAoIvTvuA',
  authDomain: 'gruposd-apps.firebaseapp.com',
  projectId: 'gruposd-apps',
  storageBucket: 'gruposd-apps.firebasestorage.app',
  messagingSenderId: '407859380596',
  appId: '1:407859380596:web:92bf1fc96f0c85357cec21',
};
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const DEMO = new URLSearchParams(location.search).has('demo');
const POR_PAGINA = 50;

const $main = document.getElementById('main');
const $dlg = document.getElementById('dlg');
const $quem = document.getElementById('quem');
const $sair = document.getElementById('sair');

let fs = null;          // funções do Firestore (verdadeiro ou de demonstração)
let auth = null;
let authFns = null;
let utilizador = null;  // email
const S = { app: null, estado: null, tab: 'perguntas', pesquisa: '', filtro: 'todas', pagina: 0, publicadas: null, versoes: null, hist: null };

// ---------- utilitários de ecrã ----------
function h(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
}
const mostra = (...nos) => { $main.replaceChildren(...nos.flat().filter(Boolean)); };
const poe = (pai, ...nos) => pai.append(...nos.flat().filter((x) => x != null && x !== false));
const data = (ms) => (ms ? new Date(ms).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const msgErro = (e) => (e && e.code === 'permission-denied' ? 'Sem permissão para esta operação.' : (e && e.message) || String(e));

async function ocupado(botao, f) {
  const txt = botao.textContent;
  botao.disabled = true; botao.textContent = 'Aguarde…';
  try { return await f(); } finally { botao.disabled = false; botao.textContent = txt; }
}

// ---------- arranque ----------
async function arrancar() {
  if (DEMO) {
    document.getElementById('demo').hidden = false;
    fs = (await import('./memoria.js')).fsMemoria;
    utilizador = 'demonstracao';
    for (const a of Object.keys(core.APPS)) await core.importarBase(fs, a, await (await fetch(`seed/${a}.json`)).json(), utilizador);
    $quem.textContent = 'Demonstração';
    return inicio();
  }
  const [{ initializeApp }, A, F] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  const app = initializeApp(CONFIG);
  auth = A.getAuth(app); authFns = A;
  fs = { db: F.getFirestore(app), doc: F.doc, collection: F.collection, getDoc: F.getDoc, getDocs: F.getDocs, setDoc: F.setDoc, addDoc: F.addDoc,
    deleteDoc: F.deleteDoc, runTransaction: F.runTransaction, writeBatch: F.writeBatch, query: F.query, orderBy: F.orderBy, limit: F.limit };
  $sair.addEventListener('click', () => A.signOut(auth));
  A.onAuthStateChanged(auth, async (u) => {
    utilizador = u ? u.email : null;
    $quem.textContent = utilizador || '';
    $sair.hidden = !u;
    if (!u) return ecraEntrar();
    try { await fs.getDoc(fs.doc(fs.db, 'apps', 'adrbase')); } catch (e) {
      if (e.code === 'permission-denied') return mostra(h('div', { class: 'centro' }, h('h2', {}, 'Sem acesso'),
        h('p', {}, `A conta ${u.email} não tem acesso ao backoffice.`), h('p', { class: 'nota' }, 'Peça ao administrador para acrescentar o seu email.')));
      return mostra(h('div', { class: 'erro' }, msgErro(e)));
    }
    inicio();
  });
}

function ecraEntrar() {
  const erro = h('div', {});
  mostra(h('div', { class: 'centro' }, h('h2', {}, 'Backoffice das apps do Grupo SD'),
    h('p', { class: 'nota' }, 'Entre com a sua conta Google.'),
    h('button', { class: 'pri', onclick: async (ev) => {
      try { await ocupado(ev.target, () => authFns.signInWithPopup(auth, new authFns.GoogleAuthProvider())); }
      catch (e) { erro.replaceChildren(h('div', { class: 'erro' }, 'Não foi possível entrar: ' + msgErro(e))); }
    } }, 'Entrar com Google'), erro));
}

// ---------- início: as 4 apps ----------
async function inicio() {
  S.app = null; S.estado = null;
  history.replaceState(null, '', location.pathname + (DEMO ? '?demo=1' : ''));
  mostra(h('div', { class: 'centro' }, 'A carregar…'));
  const ids = Object.keys(core.APPS);
  let metas;
  try { metas = await Promise.all(ids.map((a) => fs.getDoc(fs.doc(fs.db, 'apps', a)))); } catch (e) { return mostra(h('div', { class: 'erro' }, msgErro(e))); }
  const cartoes = ids.map((a, i) => {
    const cfg = core.APPS[a];
    if (!metas[i].exists()) {
      return h('div', { class: 'cartao' }, h('h2', {}, cfg.nome), h('p', { class: 'num' }, 'Ainda sem perguntas na base de dados.'),
        h('button', { class: 'pri', onclick: async (ev) => {
          try {
            await ocupado(ev.target, async () => core.importarBase(fs, a, await (await fetch(`seed/${a}.json`)).json(), utilizador));
            inicio();
          } catch (e) { alert(msgErro(e)); }
        } }, 'Carregar base inicial'),
        h('p', { class: 'nota' }, 'Copia para a base de dados as perguntas que estão hoje dentro da app.'));
    }
    const m = metas[i].data();
    const pendente = m.alteradoEm > (m.publicadoEm || 0);
    return h('div', { class: 'cartao app', onclick: () => abrirApp(a) }, h('h2', {}, cfg.nome),
      h('p', { class: 'num' }, `${m.total} perguntas · ${cfg.porTeste} por teste`),
      h('p', {}, m.publicadoVersao ? h('span', { class: 'selo' }, `Versão ${m.publicadoVersao} publicada`) : h('span', { class: 'selo cinza' }, 'Nunca publicada'),
        ' ', pendente && m.publicadoVersao ? h('span', { class: 'selo lar' }, 'Alterações por publicar') : null),
      h('p', { class: 'nota' }, m.publicadoVersao ? `Publicada em ${data(m.publicadoEm)}` : 'As apps continuam a usar as perguntas que trazem de origem.'));
  });
  const nos = [h('div', { class: 'cartoes' }, cartoes)];
  if (!DEMO) nos.push(await seccaoAcessos());
  mostra(nos);
}

async function seccaoAcessos() {
  const lista = h('ul', { class: 'limpa' });
  const refrescar = async () => {
    const s = await fs.getDocs(fs.collection(fs.db, 'admins'));
    lista.replaceChildren(h('li', {}, 'Proprietário do projeto ', h('span', { class: 'selo' }, 'sempre')),
      ...s.docs.map((d) => h('li', {}, d.id, ' ', h('button', { onclick: async () => {
        if (!confirm(`Retirar o acesso a ${d.id}?`)) return;
        try { await fs.deleteDoc(d.ref); refrescar(); } catch (e) { alert(msgErro(e)); }
      } }, 'Retirar'))));
  };
  await refrescar();
  const inp = h('input', { type: 'email', placeholder: 'email@gmail.com', style: 'max-width:320px' });
  return h('div', { class: 'cartao', style: 'margin-top:20px' }, h('h2', {}, 'Quem tem acesso'),
    h('p', { class: 'nota' }, 'Contas Google que podem entrar, editar e publicar. Só o proprietário altera esta lista.'), lista,
    h('div', { class: 'barra' }, inp, h('button', { onclick: async () => {
      const email = inp.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert('Email inválido.');
      try { await fs.setDoc(fs.doc(fs.db, 'admins', email), { desde: Date.now(), por: utilizador }); inp.value = ''; refrescar(); } catch (e) { alert(msgErro(e)); }
    } }, 'Dar acesso')));
}

// ---------- uma app ----------
async function abrirApp(a, tab = 'perguntas') {
  S.app = a; S.tab = tab; S.pesquisa = ''; S.filtro = 'todas'; S.pagina = 0; S.publicadas = null; S.versoes = null; S.hist = null;
  mostra(h('div', { class: 'centro' }, 'A carregar as perguntas…'));
  try { S.estado = await core.carregar(fs, a); } catch (e) { return mostra(h('div', { class: 'erro' }, msgErro(e))); }
  desenhar();
}

function problemasPorId() {
  const m = new Map();
  for (const p of core.validar(S.app, S.estado.perguntas)) m.set(p.id, [...(m.get(p.id) || []), p.problema]);
  return m;
}
function avisosPorId() {
  const m = new Map();
  for (const p of core.avisos(S.estado.perguntas)) m.set(p.id, [...(m.get(p.id) || []), p.problema]);
  return m;
}

function desenhar() {
  const cfg = core.APPS[S.app];
  const m = S.estado.meta;
  const cab = h('div', {}, h('div', { class: 'barra' }, h('button', { onclick: inicio }, '← Todas as apps'), h('h2', { style: 'margin:0;flex:1' }, cfg.nome),
    m.publicadoVersao ? h('span', { class: 'selo' }, `Versão ${m.publicadoVersao} publicada`) : h('span', { class: 'selo cinza' }, 'Nunca publicada'),
    m.alteradoEm > (m.publicadoEm || 0) && m.publicadoVersao ? h('span', { class: 'selo lar' }, 'Alterações por publicar') : null),
    h('div', { class: 'tabs' }, [['perguntas', 'Perguntas'], ['publicar', 'Publicar'], ['historico', 'Histórico']].map(([k, t]) =>
      h('button', { class: S.tab === k ? 'ativo' : '', onclick: () => { S.tab = k; desenhar(); } }, t))));
  const corpo = h('div', {});
  mostra(cab, corpo);
  if (S.tab === 'perguntas') tabPerguntas(corpo);
  else if (S.tab === 'publicar') tabPublicar(corpo);
  else tabHistorico(corpo);
}

function tabPerguntas(corpo) {
  const probs = problemasPorId();
  const avis = avisosPorId();
  const termo = S.pesquisa.trim().toLowerCase();
  let lista = S.estado.perguntas;
  if (S.filtro === 'problemas') lista = lista.filter((p) => probs.has(p.id));
  if (S.filtro === 'avisos') lista = lista.filter((p) => avis.has(p.id));
  if (S.filtro === 'inativas') lista = lista.filter((p) => p.ativa === false);
  if (termo) lista = lista.filter((p) => String(p.id) === termo || p.t.toLowerCase().includes(termo) || p.r.some((r) => r.t.toLowerCase().includes(termo)));
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  S.pagina = Math.min(S.pagina, paginas - 1);
  const pesquisa = h('input', { type: 'search', placeholder: 'Pesquisar por número ou texto…', value: S.pesquisa });
  pesquisa.addEventListener('input', () => { S.pesquisa = pesquisa.value; S.pagina = 0; desenhar(); const n = $main.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  const filtro = h('select', { onchange: (e) => { S.filtro = e.target.value; S.pagina = 0; desenhar(); } },
    [['todas', `Todas (${S.estado.perguntas.length})`], ['problemas', `Com problemas (${probs.size - (probs.has(0) ? 1 : 0)})`], ['avisos', `Com avisos (${avis.size})`],
      ['inativas', `Inativas (${S.estado.perguntas.filter((p) => p.ativa === false).length})`]].map(([v, t]) => h('option', { value: v, selected: S.filtro === v }, t)));
  const linhas = lista.slice(S.pagina * POR_PAGINA, (S.pagina + 1) * POR_PAGINA).map((p) => {
    const certas = p.r.filter((r) => r.c);
    return h('tr', { class: 'linha' + (p.ativa === false ? ' inativa' : ''), onclick: () => editar(p) }, h('td', { class: 'id' }, p.id),
      h('td', {}, h('div', {}, p.t), h('div', { class: 'certa' }, certas.length ? '✓ ' + certas.map((r) => r.t).join(' | ') : '')),
      h('td', { style: 'width:150px' }, p.ativa === false ? h('span', { class: 'selo cinza' }, 'Inativa') : null,
        probs.has(p.id) ? h('span', { class: 'selo erro', title: probs.get(p.id).join('\n') }, 'Problema') : null,
        avis.has(p.id) ? h('span', { class: 'selo lar', title: avis.get(p.id).join('\n') }, 'Aviso') : null));
  });
  poe(corpo, h('div', { class: 'barra' }, pesquisa, filtro, h('button', { class: 'pri', onclick: () => editar(null) }, 'Nova pergunta'), h('button', { onclick: exportar }, 'Exportar')),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'N.º'), h('th', {}, 'Pergunta e resposta certa'), h('th', {}, 'Estado'))),
      h('tbody', {}, linhas.length ? linhas : h('tr', {}, h('td', { colspan: 3, class: 'nota' }, 'Nenhuma pergunta encontrada.')))),
    h('div', { class: 'pag' }, h('button', { disabled: S.pagina === 0, onclick: () => { S.pagina--; desenhar(); } }, '‹ Anterior'),
      `Página ${S.pagina + 1} de ${paginas} · ${lista.length} perguntas`, h('button', { disabled: S.pagina >= paginas - 1, onclick: () => { S.pagina++; desenhar(); } }, 'Seguinte ›')));
}

function exportar() {
  const dados = { app: S.app, exportadoEm: new Date().toISOString(), perguntas: S.estado.perguntas.map(core.normalizar) };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: 'application/json' })), download: `${S.app}-perguntas.json` });
  a.click(); URL.revokeObjectURL(a.href);
}

function editar(p) {
  const cfg = core.APPS[S.app];
  const nova = !p;
  const base = p ? core.copia(p) : { t: '', r: Array.from({ length: cfg.nResp }, () => ({ t: '', c: false })), ativa: true };
  while (base.r.length < cfg.nResp) base.r.push({ t: '', c: false });
  const txt = h('textarea', { rows: 3, required: true }); txt.value = base.t;
  const resp = base.r.map((r, i) => {
    const radio = h('input', { type: 'radio', name: 'certa', value: i, checked: r.c, title: 'Resposta certa' });
    const t = h('textarea', { rows: 2, required: true }); t.value = r.t;
    return { radio, t, r };
  });
  const ativa = h('input', { type: 'checkbox', checked: base.ativa !== false });
  const erro = h('div', {});
  const guardar = h('button', { class: 'pri', type: 'submit' }, 'Guardar');
  const form = h('form', { method: 'dialog', onsubmit: async (ev) => {
    ev.preventDefault();
    const q = { ...base, t: txt.value, ativa: ativa.checked, r: resp.map((x) => ({ ...x.r, t: x.t.value, c: x.radio.checked })) };
    if (q.ativa && q.r.filter((r) => r.c).length !== 1) return erro.replaceChildren(h('div', { class: 'erro' }, 'Marque a resposta certa (uma só).'));
    try {
      const g = await ocupado(guardar, () => core.guardarPergunta(fs, S.app, q, utilizador));
      if (!g._igual) {
        delete g._igual;
        const i = S.estado.perguntas.findIndex((x) => x.id === g.id);
        if (i >= 0) S.estado.perguntas[i] = g; else S.estado.perguntas.push(g);
        S.estado.meta = (await fs.getDoc(fs.doc(fs.db, 'apps', S.app))).data();
        S.publicadas = null; S.hist = null;
      }
      $dlg.close(); desenhar();
    } catch (e) { erro.replaceChildren(h('div', { class: 'erro' }, msgErro(e))); }
  } }, h('h3', {}, nova ? 'Nova pergunta' : `Pergunta ${p.id}`), h('label', {}, 'Pergunta'), txt,
    h('label', {}, 'Respostas (marque a certa)'), resp.map((x) => h('div', { class: 'resp' }, x.radio, x.t)), erro,
    h('div', { class: 'acoes' }, h('label', { class: 'esq', style: 'margin:0' }, ativa, ' Ativa (aparece nos testes)'),
      h('button', { type: 'button', onclick: () => $dlg.close() }, 'Cancelar'), guardar),
    h('p', { class: 'nota' }, 'Guardar não muda nada nas apps. As alterações só chegam aos alunos depois de carregar em Publicar.'));
  $dlg.replaceChildren(form); $dlg.showModal();
}

async function tabPublicar(corpo) {
  const m = S.estado.meta;
  const probs = core.validar(S.app, S.estado.perguntas);
  const avis = core.avisos(S.estado.perguntas);
  const abre = (id) => { const p = S.estado.perguntas.find((x) => x.id === id); if (p) editar(p); };
  const listaDe = (l) => h('ul', { class: 'limpa' }, l.slice(0, 200).map((x) => h('li', {}, x.id ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); abre(x.id); } }, `Pergunta ${x.id}`) : 'Geral', ': ', x.problema)));
  const dif = h('div', { class: 'nota' }, m.publicadoVersao ? 'A comparar com a versão publicada…' : '');
  const nota = h('input', { type: 'text', placeholder: 'Nota desta publicação (opcional), por exemplo: correção da pergunta 369' });
  const res = h('div', {});
  const ativas = S.estado.perguntas.filter((p) => p.ativa !== false).length;
  const bt = h('button', { class: 'lar', disabled: probs.length > 0, onclick: async () => {
    if (!confirm(`Publicar ${ativas} perguntas de "${core.APPS[S.app].nome}"?\n\nAs apps com internet passam a usar estas perguntas da próxima vez que forem abertas.`)) return;
    try {
      const r = await ocupado(bt, () => core.publicar(fs, S.app, utilizador, nota.value.trim()));
      await abrirApp(S.app, 'publicar');
      poe($main, h('div', { class: 'ok' }, `Versão ${r.versao} publicada com ${r.total} perguntas.`));
    } catch (e) { res.replaceChildren(h('div', { class: 'erro' }, msgErro(e))); }
  } }, `Publicar ${ativas} perguntas`);
  const versoes = h('div', { class: 'nota' }, 'A carregar…');
  poe(corpo, 
    probs.length ? h('div', { class: 'erro' }, h('strong', {}, `${probs.length} problema(s) impedem a publicação:`), listaDe(probs)) : h('div', { class: 'ok' }, 'Sem problemas: pode publicar.'),
    avis.length ? h('div', { class: 'aviso' }, h('strong', {}, `${avis.length} aviso(s) (não impedem a publicação):`), listaDe(avis)) : null,
    h('div', { class: 'cartao' }, h('h2', {}, 'O que vai mudar'), dif, h('label', {}, 'Nota'), nota, h('div', { class: 'acoes' }, bt), res),
    h('div', { class: 'cartao', style: 'margin-top:14px' }, h('h2', {}, 'Versões publicadas'), versoes));
  try {
    if (m.publicadoVersao) {
      S.publicadas = S.publicadas || await core.lerPublicado(fs, S.app, m.publicadoVersao);
      const d = core.diferencas(S.estado.perguntas, S.publicadas);
      const conta = (t) => d.filter((x) => x.tipo === t);
      dif.replaceChildren(d.length ? h('div', {}, `${conta('alterada').length} alteradas, ${conta('nova').length} novas, ${conta('retirada').length} retiradas em relação à versão ${m.publicadoVersao}.`,
        h('ul', { class: 'limpa' }, d.slice(0, 100).map((x) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); abre(x.id); } }, `Pergunta ${x.id}`), ` — ${x.tipo}`))))
        : `Nada: o rascunho é igual à versão ${m.publicadoVersao}.`);
    } else dif.replaceChildren('Primeira publicação: todas as perguntas ativas passam a vir da base de dados.');
    S.versoes = S.versoes || await core.listarVersoes(fs, S.app);
    versoes.replaceChildren(S.versoes.length ? h('ul', { class: 'limpa' }, S.versoes.map((v) => h('li', {}, h('strong', {}, `Versão ${v.versao}`), ` · ${v.total} perguntas · ${data(v.publicadoEm)} · ${v.quem}`,
      v.nota ? ` · ${v.nota}` : '', ' ', v.versao === m.publicadoVersao ? h('span', { class: 'selo' }, 'atual')
        : (v.versao > m.publicadoVersao - core.VERSOES_GUARDADAS ? h('button', { onclick: async (ev) => {
          if (!confirm(`Voltar à versão ${v.versao}?\n\nO rascunho passa a ser igual a essa versão e é publicado como versão nova.`)) return;
          try { await ocupado(ev.target, () => core.reporVersao(fs, S.app, v.versao, utilizador)); await abrirApp(S.app, 'publicar'); } catch (e) { alert(msgErro(e)); }
        } }, 'Voltar a esta versão') : null)))) : 'Ainda não há versões publicadas.');
  } catch (e) { versoes.replaceChildren(h('span', {}, msgErro(e))); }
}

async function tabHistorico(corpo) {
  poe(corpo, h('p', { class: 'nota', style: 'margin-top:14px' }, 'A carregar…'));
  try { S.hist = S.hist || await core.historico(fs, S.app); } catch (e) { return corpo.replaceChildren(h('div', { class: 'erro' }, msgErro(e))); }
  const nomes = { editar: 'Editou', criar: 'Criou', importar: 'Carregou a base inicial', publicar: 'Publicou', repor: 'Repôs' };
  const detalhe = (x) => {
    if (!x.depois) return x.nota || '';
    if (!x.antes) return `pergunta ${x.id}: ${x.depois.t}`;
    const m = [];
    if (x.antes.t !== x.depois.t) m.push('texto da pergunta');
    if (JSON.stringify(x.antes.r.map((r) => r.t)) !== JSON.stringify(x.depois.r.map((r) => r.t))) m.push('texto das respostas');
    if (JSON.stringify(x.antes.r.map((r) => r.c)) !== JSON.stringify(x.depois.r.map((r) => r.c))) m.push('resposta certa');
    if (x.antes.ativa !== x.depois.ativa) m.push(x.depois.ativa ? 'reativada' : 'desativada');
    return `pergunta ${x.id}: ${m.join(', ')}`;
  };
  corpo.replaceChildren(h('table', { style: 'margin-top:14px' }, h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Quem'), h('th', {}, 'O quê'))),
    h('tbody', {}, S.hist.map((x) => h('tr', {}, h('td', { style: 'white-space:nowrap' }, data(x.quando)), h('td', {}, x.quem), h('td', {}, `${nomes[x.tipo] || x.tipo} — ${detalhe(x)}`))))),
  h('p', { class: 'nota' }, 'Últimas 100 operações.'));
}

arrancar().catch((e) => mostra(h('div', { class: 'erro' }, 'Erro ao arrancar: ' + msgErro(e))));
