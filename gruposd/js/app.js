import * as core from './core.js?v=3';

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
const MAX_COMPARAR = 4;

const $main = document.getElementById('main');
const $dlg = document.getElementById('dlg');
const $quem = document.getElementById('quem');
const $sair = document.getElementById('sair');

let fs = null;          // funções do Firestore (verdadeiro ou de demonstração)
let auth = null;
let authFns = null;
let utilizador = null;  // email
const S = { app: null, estado: null, tab: 'perguntas', pesquisa: '', filtro: 'todas', ordem: 'num', pagina: 0, publicadas: null, versoes: null, hist: null,
  histFiltro: 'todas', sel: new Set(), visiveis: [], parecidas: false, dup: null };

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
const enumera = (ids) => (ids.length <= 1 ? String(ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} e ${ids[ids.length - 1]}`);
const perguntaDe = (id) => S.estado.perguntas.find((x) => x.id === id);

async function ocupado(botao, f) {
  const txt = botao.textContent;
  botao.disabled = true; botao.textContent = 'Aguarde…';
  try { return await f(); } finally { botao.disabled = false; botao.textContent = txt; }
}

function abrirDlg(conteudo, largo = false) {
  $dlg.classList.toggle('largo', !!largo);
  $dlg.replaceChildren(conteudo);
  if (!$dlg.open) $dlg.showModal();
  $dlg.scrollTop = 0;
}

/** Texto com as diferenças marcadas em relação a `ref`. */
function comDiferencas(ref, texto) {
  return h('span', {}, core.difPalavras(ref, texto).flatMap((x) => [h(x.tipo === '+' ? 'ins' : x.tipo === '-' ? 'del' : 'span', {}, x.t), ' ']));
}

// ---------- arranque ----------
async function arrancar() {
  if (DEMO) {
    document.getElementById('demo').hidden = false;
    fs = (await import('./memoria.js?v=3')).fsMemoria;
    utilizador = 'demonstracao';
    for (const a of Object.keys(core.APPS)) await core.importarBase(fs, a, await (await fetch(`seed/${a}.json`)).json(), utilizador);
    $quem.textContent = 'Demonstração';
    return inicio();
  }
  const [{ initializeApp }, A, F] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  const app = initializeApp(CONFIG);
  auth = A.getAuth(app); authFns = A;
  fs = { db: F.getFirestore(app), doc: F.doc, collection: F.collection, getDoc: F.getDoc, getDocs: F.getDocs, setDoc: F.setDoc, addDoc: F.addDoc,
    deleteDoc: F.deleteDoc, runTransaction: F.runTransaction, writeBatch: F.writeBatch, query: F.query, orderBy: F.orderBy, limit: F.limit, where: F.where };
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
  S.app = a; S.tab = tab; S.pesquisa = ''; S.filtro = 'todas'; S.ordem = 'num'; S.pagina = 0; S.publicadas = null; S.versoes = null; S.hist = null;
  S.histFiltro = 'todas'; S.sel = new Set(); S.parecidas = false; S.dup = null;
  mostra(h('div', { class: 'centro' }, 'A carregar as perguntas…'));
  try { S.estado = await core.carregar(fs, a); } catch (e) { return mostra(h('div', { class: 'erro' }, msgErro(e))); }
  desenhar();
}

/** Volta a ler o rascunho depois de uma alteração e redesenha o separador atual. */
async function recarregar() {
  S.estado = await core.carregar(fs, S.app);
  S.hist = null; S.dup = null;
  const existem = new Set(S.estado.perguntas.map((p) => p.id));
  S.sel = new Set([...S.sel].filter((i) => existem.has(i)));
  desenhar();
}

/** Aplica alterações a várias perguntas e atualiza o ecrã. Devolve false se falhar. */
async function aplicar(ops, tipo = null) {
  try { await core.alterarEmLotes(fs, S.app, ops, utilizador, tipo); await recarregar(); return true; } catch (e) { alert(msgErro(e)); return false; }
}

function problemasPorId() {
  const m = new Map();
  for (const p of core.validar(S.app, S.estado.perguntas)) m.set(p.id, [...(m.get(p.id) || []), p.problema]);
  return m;
}
// as perguntas com o mesmo texto são tratadas no separador Duplicados
const avisosSemRepetidas = () => core.avisos(S.estado.perguntas).filter((x) => !x.problema.startsWith('Texto igual'));
function avisosPorId() {
  const m = new Map();
  for (const p of avisosSemRepetidas()) m.set(p.id, [...(m.get(p.id) || []), p.problema]);
  return m;
}
function dup() {
  S.dup = S.dup || core.duplicados(S.estado.perguntas, S.estado.meta.naoDuplicados || [], { parecidas: S.parecidas });
  return S.dup;
}
const gruposCertos = () => dup().grupos.filter((g) => g.tipo !== 'parecidas');

function desenhar() {
  const cfg = core.APPS[S.app];
  const m = S.estado.meta;
  const nDup = gruposCertos().length;
  const cab = h('div', {}, h('div', { class: 'barra' }, h('button', { onclick: inicio }, '← Todas as apps'), h('h2', { style: 'margin:0;flex:1' }, cfg.nome),
    m.publicadoVersao ? h('span', { class: 'selo' }, `Versão ${m.publicadoVersao} publicada`) : h('span', { class: 'selo cinza' }, 'Nunca publicada'),
    m.alteradoEm > (m.publicadoEm || 0) && m.publicadoVersao ? h('span', { class: 'selo lar' }, 'Alterações por publicar') : null),
    h('div', { class: 'tabs' }, [['perguntas', 'Perguntas'], ['duplicados', nDup ? `Duplicados (${nDup})` : 'Duplicados'], ['publicar', 'Publicar'], ['historico', 'Histórico']].map(([k, t]) =>
      h('button', { class: S.tab === k ? 'ativo' : '', onclick: () => { S.tab = k; desenhar(); } }, t))));
  const corpo = h('div', {});
  mostra(cab, corpo);
  if (S.tab === 'perguntas') tabPerguntas(corpo);
  else if (S.tab === 'duplicados') tabDuplicados(corpo);
  else if (S.tab === 'publicar') tabPublicar(corpo);
  else tabHistorico(corpo);
}

// ---------- separador Perguntas ----------
function tabPerguntas(corpo) {
  const probs = problemasPorId();
  const avis = avisosPorId();
  const emDup = new Set(gruposCertos().flatMap((g) => g.ids));
  const termo = S.pesquisa.trim().toLowerCase();
  let lista = S.estado.perguntas;
  let alteradas = null;
  if (S.filtro === 'alteradas') {
    if (!S.publicadas) {
      poe(corpo, h('p', { class: 'nota', style: 'margin-top:14px' }, 'A comparar com a versão publicada…'));
      core.lerPublicado(fs, S.app, S.estado.meta.publicadoVersao).then((p) => { S.publicadas = p; desenhar(); }).catch((e) => { S.filtro = 'todas'; alert(msgErro(e)); desenhar(); });
      return;
    }
    alteradas = new Map(core.diferencas(S.estado.perguntas, S.publicadas).map((x) => [x.id, x.tipo]));
    lista = lista.filter((p) => alteradas.has(p.id));
  }
  if (S.filtro === 'problemas') lista = lista.filter((p) => probs.has(p.id));
  if (S.filtro === 'avisos') lista = lista.filter((p) => avis.has(p.id));
  if (S.filtro === 'duplicadas') lista = lista.filter((p) => emDup.has(p.id));
  if (S.filtro === 'inativas') lista = lista.filter((p) => p.ativa === false);
  if (termo) lista = lista.filter((p) => String(p.id) === termo || p.t.toLowerCase().includes(termo) || p.r.some((r) => r.t.toLowerCase().includes(termo)));
  if (S.ordem === 'numd') lista = [...lista].sort((a, b) => b.id - a.id);
  if (S.ordem === 'txt') lista = [...lista].sort((a, b) => a.t.localeCompare(b.t, 'pt'));
  S.visiveis = lista.map((p) => p.id);
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  S.pagina = Math.min(S.pagina, paginas - 1);
  const naPagina = lista.slice(S.pagina * POR_PAGINA, (S.pagina + 1) * POR_PAGINA);

  const pesquisa = h('input', { type: 'search', placeholder: 'Pesquisar por número ou texto…', value: S.pesquisa });
  pesquisa.addEventListener('input', () => { S.pesquisa = pesquisa.value; S.pagina = 0; desenhar(); const n = $main.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  const opcoesFiltro = [['todas', `Todas (${S.estado.perguntas.length})`], ['problemas', `Com problemas (${probs.size - (probs.has(0) ? 1 : 0)})`], ['avisos', `Com avisos (${avis.size})`],
    ['duplicadas', `Duplicadas (${emDup.size})`], ['inativas', `Inativas (${S.estado.perguntas.filter((p) => p.ativa === false).length})`]];
  if (S.estado.meta.publicadoVersao) opcoesFiltro.push(['alteradas', 'Alteradas desde a publicação']);
  const filtro = h('select', { title: 'Filtrar', onchange: (e) => { S.filtro = e.target.value; S.pagina = 0; desenhar(); } }, opcoesFiltro.map(([v, t]) => h('option', { value: v, selected: S.filtro === v }, t)));
  const ordem = h('select', { title: 'Ordenar', onchange: (e) => { S.ordem = e.target.value; S.pagina = 0; desenhar(); } },
    [['num', 'N.º crescente'], ['numd', 'N.º decrescente'], ['txt', 'Texto A–Z']].map(([v, t]) => h('option', { value: v, selected: S.ordem === v }, t)));

  const todasNaPagina = naPagina.length > 0 && naPagina.every((p) => S.sel.has(p.id));
  const marcaTodas = h('input', { type: 'checkbox', checked: todasNaPagina, title: 'Selecionar as perguntas desta página', onchange: (e) => {
    for (const p of naPagina) { if (e.target.checked) S.sel.add(p.id); else S.sel.delete(p.id); }
    desenhar();
  } });
  const linhas = naPagina.map((p) => {
    const certas = p.r.filter((r) => r.c);
    return h('tr', { class: 'linha' + (p.ativa === false ? ' inativa' : '') + (S.sel.has(p.id) ? ' marcada' : ''), onclick: () => editar(p) },
      h('td', { class: 'cx', onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', checked: S.sel.has(p.id), 'aria-label': `Selecionar a pergunta ${p.id}`, onchange: (e) => {
        if (e.target.checked) S.sel.add(p.id); else S.sel.delete(p.id);
        desenhar();
      } })),
      h('td', { class: 'id' }, p.id),
      h('td', {}, h('div', {}, p.t), h('div', { class: 'certa' }, certas.length ? '✓ ' + certas.map((r) => r.t).join(' | ') : '')),
      h('td', { style: 'width:170px' }, p.ativa === false ? h('span', { class: 'selo cinza' }, 'Inativa') : null,
        probs.has(p.id) ? h('span', { class: 'selo erro', title: probs.get(p.id).join('\n') }, 'Problema') : null,
        emDup.has(p.id) ? h('span', { class: 'selo lar', title: 'Há outra pergunta com o mesmo texto. Veja o separador Duplicados.' }, 'Duplicada')
          : (avis.has(p.id) ? h('span', { class: 'selo lar', title: avis.get(p.id).join('\n') }, 'Aviso') : null),
        alteradas ? h('span', { class: 'selo' }, alteradas.get(p.id)) : null));
  });

  poe(corpo, h('div', { class: 'barra' }, pesquisa, filtro, ordem, h('button', { class: 'pri', onclick: () => editar(null) }, 'Nova pergunta'),
    h('button', { onclick: dlgSubstituir }, 'Localizar e substituir'), h('button', { onclick: exportar }, 'Exportar')),
  S.sel.size ? barraSelecao() : null,
  h('table', {}, h('thead', {}, h('tr', {}, h('th', { class: 'cx' }, marcaTodas), h('th', {}, 'N.º'), h('th', {}, 'Pergunta e resposta certa'), h('th', {}, 'Estado'))),
    h('tbody', {}, linhas.length ? linhas : h('tr', {}, h('td', { colspan: 4, class: 'nota' }, 'Nenhuma pergunta encontrada.')))),
  h('div', { class: 'pag' }, h('button', { disabled: S.pagina === 0, onclick: () => { S.pagina--; desenhar(); } }, '‹ Anterior'),
    `Página ${S.pagina + 1} de ${paginas} · ${lista.length} perguntas`, h('button', { disabled: S.pagina >= paginas - 1, onclick: () => { S.pagina++; desenhar(); } }, 'Seguinte ›')));
}

function barraSelecao() {
  const ids = [...S.sel].sort((a, b) => a - b);
  const n = ids.length;
  const sel = ids.map(perguntaDe).filter(Boolean);
  const ativas = sel.filter((p) => p.ativa !== false).length;
  return h('div', { class: 'selbar' }, h('strong', {}, n === 1 ? '1 pergunta selecionada' : `${n} perguntas selecionadas`),
    h('button', { disabled: n < 2 || n > MAX_COMPARAR, title: `Escolha de 2 a ${MAX_COMPARAR} perguntas`, onclick: () => comparar(ids) }, 'Comparar'),
    h('button', { disabled: ativas === 0, onclick: async (ev) => {
      if (!confirm(`Desativar ${ativas} pergunta(s)?\n\nDeixam de aparecer nos testes depois de publicar. Pode reativá-las quando quiser.`)) return;
      await ocupado(ev.target, () => aplicar(ids.map((id) => ({ id, ativa: false }))));
    } }, 'Desativar'),
    h('button', { disabled: ativas === n, onclick: (ev) => ocupado(ev.target, () => aplicar(ids.map((id) => ({ id, ativa: true })))) }, 'Reativar'),
    h('button', { class: 'perigo', onclick: async (ev) => {
      if (!confirm(`Apagar ${n} pergunta(s) (${enumera(ids.slice(0, 12))}${n > 12 ? '…' : ''})?\n\nSaem da lista. Podem ser repostas no separador Histórico.`)) return;
      await ocupado(ev.target, () => aplicar(ids.map((id) => ({ id, apagar: true }))));
    } }, 'Apagar'),
    h('button', { onclick: () => { S.sel = new Set(); desenhar(); } }, 'Limpar seleção'));
}

function exportar() {
  const dados = { app: S.app, exportadoEm: new Date().toISOString(), perguntas: S.estado.perguntas.map(core.normalizar) };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: 'application/json' })), download: `${S.app}-perguntas.json` });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- editar uma pergunta ----------
/** `p` nula = pergunta nova; `modelo` = conteúdo inicial de uma pergunta nova (duplicar). */
function editar(p, modelo = null) {
  const cfg = core.APPS[S.app];
  const nova = !p;
  const base = p ? core.copia(p) : (modelo ? { t: modelo.t, r: modelo.r.map((r) => ({ t: r.t, c: r.c })), ativa: true } : { t: '', r: Array.from({ length: cfg.nResp }, () => ({ t: '', c: false })), ativa: true });
  while (base.r.length < cfg.nResp) base.r.push({ t: '', c: false });
  const txt = h('textarea', { rows: 3, required: true }); txt.value = base.t;
  const resp = base.r.map((r, i) => {
    const radio = h('input', { type: 'radio', name: 'certa', value: i, checked: r.c, title: 'Resposta certa' });
    const t = h('textarea', { rows: 2, required: true }); t.value = r.t;
    return { radio, t, r };
  });
  const ativa = h('input', { type: 'checkbox', checked: base.ativa !== false });
  const erro = h('div', {});
  const avisoDup = h('div', {});
  const verDup = () => {
    const k = core.chave(txt.value);
    const iguais = k ? S.estado.perguntas.filter((x) => x.ativa !== false && x.id !== base.id && core.chave(x.t) === k).map((x) => x.id) : [];
    const textos = resp.map((x) => core.chave(x.t.value)).filter(Boolean);
    avisoDup.replaceChildren(...[
      iguais.length ? h('div', { class: 'aviso' }, `Já existe ${iguais.length === 1 ? 'a pergunta' : 'as perguntas'} ${enumera(iguais.slice(0, 6))} com este texto. `,
        p && iguais.length < MAX_COMPARAR ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); comparar([p.id, ...iguais]); } }, 'Comparar') : null) : null,
      new Set(textos).size !== textos.length ? h('div', { class: 'aviso' }, 'Há respostas com o mesmo texto.') : null].filter(Boolean));
  };
  txt.addEventListener('input', verDup); resp.forEach((x) => x.t.addEventListener('input', verDup)); verDup();

  const gravar = async (botao) => {
    const q = { ...base, t: txt.value, ativa: ativa.checked, r: resp.map((x) => ({ ...x.r, t: x.t.value, c: x.radio.checked })) };
    if (!form.reportValidity()) return false;
    if (q.ativa && q.r.filter((r) => r.c).length !== 1) { erro.replaceChildren(h('div', { class: 'erro' }, 'Marque a resposta certa (uma só).')); return false; }
    try {
      const g = await ocupado(botao, () => core.guardarPergunta(fs, S.app, q, utilizador));
      if (!g._igual) {
        delete g._igual;
        const i = S.estado.perguntas.findIndex((x) => x.id === g.id);
        if (i >= 0) S.estado.perguntas[i] = g; else S.estado.perguntas.push(g);
        S.estado.meta = (await fs.getDoc(fs.doc(fs.db, 'apps', S.app))).data();
        S.hist = null; S.dup = null;
      }
      return true;
    } catch (e) { erro.replaceChildren(h('div', { class: 'erro' }, msgErro(e))); return false; }
  };
  const guardar = h('button', { class: 'pri', type: 'submit' }, 'Guardar');
  const pos = p ? S.visiveis.indexOf(p.id) : -1;
  const seguinte = pos >= 0 && pos < S.visiveis.length - 1 ? perguntaDe(S.visiveis[pos + 1]) : null;
  const guardarSeg = seguinte ? h('button', { type: 'button', title: `Guarda e abre a pergunta ${seguinte.id}`, onclick: async (ev) => {
    if (await gravar(ev.target)) { desenhar(); editar(perguntaDe(seguinte.id)); }
  } }, 'Guardar e seguinte ›') : null;

  const mais = p ? h('div', { class: 'mais' },
    h('button', { type: 'button', onclick: () => editar(null, p) }, 'Duplicar'),
    h('button', { type: 'button', onclick: () => dlgHistoricoPergunta(p) }, 'Histórico'),
    S.estado.meta.publicadoVersao ? h('button', { type: 'button', onclick: async (ev) => {
      try {
        S.publicadas = S.publicadas || await ocupado(ev.target, () => core.lerPublicado(fs, S.app, S.estado.meta.publicadoVersao));
        const pub = S.publicadas.find((x) => x.id === p.id);
        if (!pub) return alert('Esta pergunta não faz parte da versão publicada.');
        compararVersoes(`Pergunta ${p.id}: publicada e rascunho`, [{ p: pub, rotulo: `Versão ${S.estado.meta.publicadoVersao} publicada` }, { p, rotulo: 'Rascunho' }], () => editar(perguntaDe(p.id)));
      } catch (e) { alert(msgErro(e)); }
    } }, 'Comparar com a publicada') : null,
    h('button', { type: 'button', class: 'perigo', onclick: async (ev) => {
      if (!confirm(`Apagar a pergunta ${p.id}?\n\nSai da lista. Pode ser reposta no separador Histórico.`)) return;
      if (await ocupado(ev.target, () => aplicar([{ id: p.id, apagar: true }]))) $dlg.close();
    } }, 'Apagar')) : null;

  const form = h('form', { method: 'dialog', onsubmit: async (ev) => { ev.preventDefault(); if (await gravar(guardar)) { $dlg.close(); desenhar(); } } },
    h('h3', {}, nova ? (modelo ? `Nova pergunta (cópia da ${modelo.id})` : 'Nova pergunta') : `Pergunta ${p.id}`), mais,
    h('label', {}, 'Pergunta'), txt, avisoDup,
    h('label', {}, 'Respostas (marque a certa)'), resp.map((x) => h('div', { class: 'resp' }, x.radio, x.t)), erro,
    h('div', { class: 'acoes' }, h('label', { class: 'esq', style: 'margin:0' }, ativa, ' Ativa (aparece nos testes)'),
      h('button', { type: 'button', onclick: () => $dlg.close() }, 'Cancelar'), guardarSeg, guardar),
    h('p', { class: 'nota' }, 'Guardar não muda nada nas apps. As alterações só chegam aos alunos depois de carregar em Publicar.'));
  abrirDlg(form);
}

// ---------- comparar ----------
/** Cartão de uma pergunta dentro de uma comparação. `ref` é a pergunta de referência (a primeira). */
function cartaoComparar(p, ref, outras, rotulo, acoes) {
  const noutras = (r) => outras.every((o) => o.r.some((x) => core.chave(x.t) === core.chave(r.t) && !!x.c === !!r.c));
  return h('div', { class: 'cartao comp' + (p.ativa === false ? ' inativa' : '') }, h('h4', {}, rotulo, ' ', p.ativa === false ? h('span', { class: 'selo cinza' }, 'Inativa') : null),
    h('p', { class: 'ptxt' }, ref ? comDiferencas(ref.t, p.t) : p.t),
    h('ul', { class: 'limpa resps' }, p.r.map((r) => h('li', { class: (r.c ? 'c ' : '') + (noutras(r) ? '' : 'dif') }, h('span', { class: 'marca' }, r.c ? '✓' : '○'), ' ', r.t))),
    acoes && acoes.length ? h('div', { class: 'mais' }, acoes) : null);
}

function resumoComparar(ps) {
  const igual = (f) => new Set(ps.map(f)).size === 1;
  const linha = (nome, ok) => h('span', { class: 'selo ' + (ok ? '' : 'erro') }, `${nome}: ${ok ? 'igual' : 'diferente'}`);
  const erradas = (p) => p.r.filter((r) => !r.c).map((r) => core.chave(r.t)).sort().join('|');
  const certa = (p) => p.r.filter((r) => r.c).map((r) => core.chave(r.t)).sort().join('|');
  return h('p', { class: 'resumo' }, linha('Texto da pergunta', igual((p) => core.chave(p.t))), ' ', linha('Resposta certa', igual(certa)), ' ', linha('Respostas erradas', igual(erradas)));
}

/** Compara perguntas do rascunho lado a lado, com ações. */
function comparar(ids) {
  const ps = ids.map(perguntaDe).filter(Boolean);
  if (ps.length < 2) { if ($dlg.open) $dlg.close(); return; }
  const depois = async (ok) => { if (ok) comparar(ids.filter((i) => { const q = perguntaDe(i); return q && q.ativa !== false; })); };
  const cartoes = ps.map((p, i) => cartaoComparar(p, i ? ps[0] : null, ps.filter((x) => x !== p), `Pergunta ${p.id}`, [
    h('button', { type: 'button', onclick: () => editar(p) }, 'Editar'),
    h('button', { type: 'button', class: 'pri', title: 'Apaga as outras perguntas desta comparação', onclick: async (ev) => {
      const outras = ps.filter((x) => x.id !== p.id).map((x) => x.id);
      if (!confirm(`Manter a pergunta ${p.id} e apagar ${outras.length === 1 ? 'a pergunta' : 'as perguntas'} ${enumera(outras)}?\n\nAs apagadas podem ser repostas no separador Histórico.`)) return;
      if (await ocupado(ev.target, () => aplicar(outras.map((id) => ({ id, apagar: true }))))) $dlg.close();
    } }, 'Manter só esta'),
    p.ativa !== false ? h('button', { type: 'button', onclick: (ev) => ocupado(ev.target, async () => depois(await aplicar([{ id: p.id, ativa: false }]))) }, 'Desativar') : null,
    h('button', { type: 'button', class: 'perigo', onclick: async (ev) => {
      if (!confirm(`Apagar a pergunta ${p.id}?\n\nPode ser reposta no separador Histórico.`)) return;
      await ocupado(ev.target, async () => depois(await aplicar([{ id: p.id, apagar: true }])));
    } }, 'Apagar')]));
  abrirDlg(h('form', { method: 'dialog' }, h('h3', {}, `Comparar as perguntas ${enumera(ps.map((p) => p.id))}`), resumoComparar(ps),
    h('p', { class: 'nota' }, 'A verde, o que só existe nessa pergunta; a vermelho riscado, o que só existe na primeira. As respostas com fundo amarelo não existem iguais nas outras.'),
    h('div', { class: 'grelha', style: `grid-template-columns:repeat(${ps.length},minmax(0,1fr))` }, cartoes),
    h('div', { class: 'acoes' }, h('button', { type: 'button', title: 'Deixam de aparecer no separador Duplicados', onclick: async (ev) => {
      try { S.estado.meta = await ocupado(ev.target, () => core.marcarDiferentes(fs, S.app, ps.map((p) => p.id))); S.dup = null; $dlg.close(); desenhar(); } catch (e) { alert(msgErro(e)); }
    } }, 'São perguntas diferentes'), h('button', { type: 'button', onclick: () => $dlg.close() }, 'Fechar'))), true);
}

/** Compara duas versões da mesma pergunta (só leitura). `extra` são botões para o rodapé. */
function compararVersoes(titulo, itens, voltar = null, extra = []) {
  const ps = itens.map((x) => x.p);
  abrirDlg(h('form', { method: 'dialog' }, h('h3', {}, titulo), resumoComparar(ps),
    h('div', { class: 'grelha', style: `grid-template-columns:repeat(${ps.length},minmax(0,1fr))` }, itens.map((x, i) => cartaoComparar(x.p, i ? ps[0] : null, ps.filter((q) => q !== x.p), x.rotulo, null))),
    h('div', { class: 'acoes' }, extra, voltar ? h('button', { type: 'button', onclick: voltar }, '‹ Voltar') : null, h('button', { type: 'button', onclick: () => $dlg.close() }, 'Fechar'))), true);
}

// ---------- histórico de uma pergunta ----------
const NOMES = { editar: 'Editou', criar: 'Criou', importar: 'Carregou a base inicial', publicar: 'Publicou', repor: 'Repôs', desativar: 'Desativou', ativar: 'Reativou', apagar: 'Apagou', substituir: 'Substituiu texto' };

function oQueMudou(x) {
  if (!x.antes && !x.depois) return x.nota || '';
  if (!x.depois) return `pergunta ${x.id}: ${x.antes.t}`;
  if (!x.antes) return `pergunta ${x.id}: ${x.depois.t}`;
  const m = [];
  if (x.antes.t !== x.depois.t) m.push('texto da pergunta');
  if (JSON.stringify(x.antes.r.map((r) => r.t)) !== JSON.stringify(x.depois.r.map((r) => r.t))) m.push('texto das respostas');
  if (JSON.stringify(x.antes.r.map((r) => r.c)) !== JSON.stringify(x.depois.r.map((r) => r.c))) m.push('resposta certa');
  if (x.antes.ativa !== x.depois.ativa && !['ativar', 'desativar'].includes(x.tipo)) m.push(x.depois.ativa ? 'reativada' : 'desativada');
  return `pergunta ${x.id}${m.length ? ': ' + m.join(', ') : ''}`;
}

/** Repõe uma pergunta no estado `estado` (de um registo do histórico). */
async function reporEstado(estado, botao) {
  const existe = perguntaDe(estado.id);
  if (!confirm(existe ? `Repor a pergunta ${estado.id} como estava nesta data?\n\nO conteúdo atual é substituído (fica no histórico).` : `Repor a pergunta ${estado.id}?`)) return false;
  return ocupado(botao, () => aplicar([{ id: estado.id, por: estado }], 'repor'));
}

async function dlgHistoricoPergunta(p) {
  abrirDlg(h('form', { method: 'dialog' }, h('h3', {}, `Histórico da pergunta ${p.id}`), h('p', { class: 'nota' }, 'A carregar…')));
  let lista;
  try { lista = await core.historicoPergunta(fs, S.app, p.id); } catch (e) { lista = null; alert(msgErro(e)); }
  const linhas = (lista || []).map((x) => h('li', {}, h('strong', {}, data(x.quando)), ` · ${x.quem} · ${NOMES[x.tipo] || x.tipo}${x.antes && x.depois ? ' — ' + oQueMudou(x).replace(/^pergunta \d+:? ?/, '') : ''} `,
    x.antes && x.depois ? h('button', { type: 'button', onclick: () => compararVersoes(`Pergunta ${p.id}: alteração de ${data(x.quando)}`, [{ p: x.antes, rotulo: 'Antes' }, { p: x.depois, rotulo: 'Depois' }], () => dlgHistoricoPergunta(p)) }, 'Ver') : null, ' ',
    x.antes ? h('button', { type: 'button', onclick: async (ev) => { if (await reporEstado(x.antes, ev.target)) $dlg.close(); } }, 'Repor como estava antes') : null));
  abrirDlg(h('form', { method: 'dialog' }, h('h3', {}, `Histórico da pergunta ${p.id}`),
    linhas.length ? h('ul', { class: 'limpa' }, linhas) : h('p', { class: 'nota' }, 'Esta pergunta nunca foi alterada desde que a base inicial foi carregada.'),
    h('div', { class: 'acoes' }, h('button', { type: 'button', onclick: () => editar(perguntaDe(p.id) || p) }, '‹ Voltar'), h('button', { type: 'button', onclick: () => $dlg.close() }, 'Fechar'))));
}

// ---------- localizar e substituir ----------
function dlgSubstituir() {
  const de = h('input', { type: 'text', placeholder: 'Texto a procurar, por exemplo: objectos' });
  const para = h('input', { type: 'text', placeholder: 'Texto novo, por exemplo: objetos' });
  const onde = h('select', {}, [['tudo', 'Perguntas e respostas'], ['perguntas', 'Só perguntas'], ['respostas', 'Só respostas']].map(([v, t]) => h('option', { value: v }, t)));
  const mai = h('input', { type: 'checkbox', checked: true });
  const pre = h('div', {});
  const bt = h('button', { class: 'pri', type: 'button', disabled: true }, 'Substituir');
  let mud = [];
  const ver = () => {
    mud = core.substituir(S.estado.perguntas, de.value, para.value, { onde: onde.value, maiusculas: mai.checked });
    bt.disabled = !mud.length;
    bt.textContent = mud.length ? `Substituir em ${mud.length} pergunta(s)` : 'Substituir';
    if (!de.value) return pre.replaceChildren();
    if (!mud.length) return pre.replaceChildren(h('p', { class: 'nota' }, 'Nenhuma pergunta ativa tem este texto.'));
    const linhas = mud.slice(0, 30).map((m) => {
      const partes = [];
      if (m.antes.t !== m.depois.t) partes.push(h('div', {}, comDiferencas(m.antes.t, m.depois.t)));
      m.antes.r.forEach((r, i) => { if (r.t !== m.depois.r[i].t) partes.push(h('div', { class: 'nota' }, 'Resposta: ', comDiferencas(r.t, m.depois.r[i].t))); });
      return h('li', {}, h('strong', {}, `Pergunta ${m.id}`), partes);
    });
    pre.replaceChildren(h('p', {}, `${mud.reduce((s, m) => s + m.vezes, 0)} ocorrência(s) em ${mud.length} pergunta(s) ativa(s).`), h('ul', { class: 'limpa' }, linhas),
      mud.length > 30 ? h('p', { class: 'nota' }, `… e mais ${mud.length - 30} perguntas.`) : null);
  };
  [de, para].forEach((x) => x.addEventListener('input', ver)); onde.addEventListener('change', ver); mai.addEventListener('change', ver);
  bt.addEventListener('click', async () => {
    if (!confirm(`Substituir "${de.value}" por "${para.value}" em ${mud.length} pergunta(s)?\n\nCada alteração fica no histórico e pode ser desfeita pergunta a pergunta.`)) return;
    if (await ocupado(bt, () => aplicar(mud.map((m) => ({ id: m.id, por: m.depois })), 'substituir'))) $dlg.close();
  });
  abrirDlg(h('form', { method: 'dialog', onsubmit: (e) => e.preventDefault() }, h('h3', {}, 'Localizar e substituir'),
    h('p', { class: 'nota' }, 'Para corrigir a mesma palavra ou expressão em várias perguntas de uma vez. Veja a lista antes de substituir.'),
    h('label', {}, 'Procurar'), de, h('label', {}, 'Substituir por'), para,
    h('div', { class: 'barra' }, onde, h('label', { style: 'margin:0;display:flex;gap:6px;align-items:center' }, mai, ' Distinguir maiúsculas de minúsculas')),
    pre, h('div', { class: 'acoes' }, h('button', { type: 'button', onclick: () => $dlg.close() }, 'Cancelar'), bt)), true);
}

// ---------- separador Duplicados ----------
function tabDuplicados(corpo) {
  const d = dup();
  const seccoes = [
    ['certa_diferente', 'Mesma pergunta, resposta certa diferente', 'Convém ver primeiro: ou uma das respostas certas está errada, ou são perguntas diferentes que precisam de um texto que as distinga.'],
    ['iguais', 'Repetidas (pergunta e respostas iguais)', 'São a mesma pergunta duas vezes. Basta ficar com uma.'],
    ['mesma_certa', 'Mesma pergunta e mesma resposta certa, respostas erradas diferentes', 'A mesma pergunta com alternativas erradas diferentes. Pode ficar com a melhor.'],
    ['parecidas', 'Texto parecido', 'Texto quase igual. Muitas vezes são perguntas diferentes (por exemplo, só muda a classe ou o número).'],
  ];
  const linhaGrupo = (g) => {
    const p = perguntaDe(g.ids[0]);
    return h('li', { class: 'grupo' }, h('div', { class: 'gtxt' }, h('strong', {}, `Perguntas ${enumera(g.ids)}`), h('div', {}, p.t)),
      h('div', { class: 'mais' }, h('button', { onclick: () => comparar(g.ids.slice(0, MAX_COMPARAR)) }, 'Comparar'),
        g.tipo === 'iguais' ? h('button', { onclick: async (ev) => {
          if (!confirm(`Manter a pergunta ${g.ids[0]} e apagar ${enumera(g.ids.slice(1))}?\n\nPodem ser repostas no separador Histórico.`)) return;
          await ocupado(ev.target, () => aplicar(g.ids.slice(1).map((id) => ({ id, apagar: true }))));
        } }, `Manter a ${g.ids[0]}, apagar ${g.ids.length === 2 ? 'a ' + g.ids[1] : 'as outras'}`) : null,
        h('button', { title: 'Deixam de aparecer aqui', onclick: async (ev) => {
          try { S.estado.meta = await ocupado(ev.target, () => core.marcarDiferentes(fs, S.app, g.ids)); S.dup = null; desenhar(); } catch (e) { alert(msgErro(e)); }
        } }, 'São perguntas diferentes')));
  };
  const blocos = seccoes.map(([tipo, titulo, expl]) => {
    const gs = d.grupos.filter((g) => g.tipo === tipo);
    if (!gs.length) return null;
    const repetidas = gs.flatMap((g) => g.ids.slice(1));
    return h('div', { class: 'cartao', style: 'margin-top:14px' }, h('h2', {}, `${titulo} `, h('span', { class: 'selo ' + (tipo === 'certa_diferente' ? 'erro' : 'lar') }, `${gs.length} ${gs.length === 1 ? 'grupo' : 'grupos'}`)),
      h('p', { class: 'nota' }, expl),
      tipo === 'iguais' ? h('p', {}, h('button', { class: 'lar', onclick: async (ev) => {
        if (!confirm(`Apagar ${repetidas.length} pergunta(s) repetida(s), ficando em cada grupo a de número mais baixo?\n\nApagadas: ${enumera(repetidas.slice(0, 20))}${repetidas.length > 20 ? '…' : ''}\n\nPodem ser repostas no separador Histórico.`)) return;
        await ocupado(ev.target, () => aplicar(repetidas.map((id) => ({ id, apagar: true }))));
      } }, `Apagar as ${repetidas.length} repetidas de uma vez`)) : null,
      h('ul', { class: 'limpa' }, gs.map(linhaGrupo)));
  });
  const marc = h('input', { type: 'checkbox', checked: S.parecidas, onchange: (e) => { S.parecidas = e.target.checked; S.dup = null; corpo.replaceChildren(h('p', { class: 'nota', style: 'margin-top:14px' }, 'A procurar…')); setTimeout(desenhar, 30); } });
  const nIgn = (S.estado.meta.naoDuplicados || []).length;
  poe(corpo, h('div', { class: 'barra' }, h('label', { style: 'margin:0;display:flex;gap:6px;align-items:center;color:inherit;font-size:inherit' }, marc, ' Procurar também perguntas com texto parecido'),
    nIgn ? h('span', { class: 'nota' }, `${nIgn} par(es) marcados como perguntas diferentes.`) : null),
  d.grupos.length ? blocos : h('div', { class: 'ok' }, 'Não há perguntas ativas repetidas.'),
  d.respostasRepetidas.length ? h('div', { class: 'cartao', style: 'margin-top:14px' }, h('h2', {}, 'Respostas repetidas dentro da mesma pergunta ', h('span', { class: 'selo lar' }, d.respostasRepetidas.length)),
    h('p', { class: 'nota' }, 'A pergunta tem duas respostas com o mesmo texto.'),
    h('ul', { class: 'limpa' }, d.respostasRepetidas.map((id) => { const p = perguntaDe(id); return h('li', { class: 'grupo' }, h('div', { class: 'gtxt' }, h('strong', {}, `Pergunta ${id}`), h('div', {}, p.t)), h('div', { class: 'mais' }, h('button', { onclick: () => editar(p) }, 'Editar'))); }))) : null,
  h('p', { class: 'nota' }, 'A comparação ignora maiúsculas, acentos e pontuação. Só conta perguntas ativas.'));
}

// ---------- separador Publicar ----------
async function tabPublicar(corpo) {
  const m = S.estado.meta;
  const probs = core.validar(S.app, S.estado.perguntas);
  const avis = avisosSemRepetidas();
  const abre = (id) => { const p = perguntaDe(id); if (p) editar(p); };
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
  const nDup = gruposCertos().length;
  poe(corpo,
    probs.length ? h('div', { class: 'erro' }, h('strong', {}, `${probs.length} problema(s) impedem a publicação:`), listaDe(probs)) : h('div', { class: 'ok' }, 'Sem problemas: pode publicar.'),
    nDup ? h('div', { class: 'aviso' }, `${nDup} grupo(s) de perguntas repetidas (não impedem a publicação). `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); S.tab = 'duplicados'; desenhar(); } }, 'Ver duplicados')) : null,
    avis.length ? h('div', { class: 'aviso' }, h('strong', {}, `${avis.length} aviso(s) (não impedem a publicação):`), listaDe(avis)) : null,
    h('div', { class: 'cartao' }, h('h2', {}, 'O que vai mudar'), dif, h('label', {}, 'Nota'), nota, h('div', { class: 'acoes' }, bt), res),
    h('div', { class: 'cartao', style: 'margin-top:14px' }, h('h2', {}, 'Versões publicadas'), versoes));
  try {
    if (m.publicadoVersao) {
      S.publicadas = S.publicadas || await core.lerPublicado(fs, S.app, m.publicadoVersao);
      const d = core.diferencas(S.estado.perguntas, S.publicadas);
      const conta = (t) => d.filter((x) => x.tipo === t);
      const verDif = (id) => {
        const pub = S.publicadas.find((x) => x.id === id); const p = perguntaDe(id);
        if (pub && p) compararVersoes(`Pergunta ${id}: publicada e rascunho`, [{ p: pub, rotulo: `Versão ${m.publicadoVersao} publicada` }, { p, rotulo: 'Rascunho' }], null, [h('button', { type: 'button', onclick: () => editar(p) }, 'Editar')]);
        else if (p) editar(p);
        else if (pub) compararVersoes(`Pergunta ${id}: apagada do rascunho`, [{ p: pub, rotulo: `Versão ${m.publicadoVersao} publicada` }]);
      };
      const apagadas = S.publicadas.filter((x) => !perguntaDe(x.id)).map((x) => ({ id: x.id, tipo: 'retirada (apagada)' }));
      const tudo = [...d, ...apagadas].sort((a, b) => a.id - b.id);
      dif.replaceChildren(tudo.length ? h('div', {}, `${conta('alterada').length} alteradas, ${conta('nova').length} novas, ${conta('retirada').length + apagadas.length} retiradas em relação à versão ${m.publicadoVersao}.`,
        h('ul', { class: 'limpa' }, tudo.slice(0, 100).map((x) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); verDif(x.id); } }, `Pergunta ${x.id}`), ` — ${x.tipo}`))))
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

// ---------- separador Histórico ----------
async function tabHistorico(corpo) {
  poe(corpo, h('p', { class: 'nota', style: 'margin-top:14px' }, 'A carregar…'));
  let lista;
  try {
    if (S.histFiltro === 'apagadas') lista = await core.apagadas(fs, S.app);
    else lista = S.hist = S.hist || await core.historico(fs, S.app);
  } catch (e) { return corpo.replaceChildren(h('div', { class: 'erro' }, msgErro(e))); }
  const filtro = h('select', { onchange: (e) => { S.histFiltro = e.target.value; desenhar(); } },
    [['todas', 'Últimas 100 operações'], ['apagadas', 'Perguntas apagadas']].map(([v, t]) => h('option', { value: v, selected: S.histFiltro === v }, t)));
  const accoes = (x) => {
    if (x.antes && !x.depois) {
      return perguntaDe(x.id) ? h('span', { class: 'nota' }, 'Já reposta') : h('button', { onclick: async (ev) => { await reporEstado(x.antes, ev.target); } }, 'Repor');
    }
    if (x.antes && x.depois) return h('button', { onclick: () => compararVersoes(`Pergunta ${x.id}: alteração de ${data(x.quando)}`, [{ p: x.antes, rotulo: 'Antes' }, { p: x.depois, rotulo: 'Depois' }]) }, 'Ver');
    return null;
  };
  corpo.replaceChildren(h('div', { class: 'barra' }, filtro),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', {}, 'Quem'), h('th', {}, 'O quê'), h('th', {}, ''))),
      h('tbody', {}, lista.length ? lista.map((x) => h('tr', {}, h('td', { style: 'white-space:nowrap' }, data(x.quando)), h('td', {}, x.quem), h('td', {}, `${NOMES[x.tipo] || x.tipo} — ${oQueMudou(x)}`), h('td', { style: 'white-space:nowrap' }, accoes(x))))
        : h('tr', {}, h('td', { colspan: 4, class: 'nota' }, 'Nada para mostrar.')))),
    h('p', { class: 'nota' }, S.histFiltro === 'apagadas' ? 'Todas as perguntas apagadas. "Repor" devolve a pergunta à lista com o mesmo número.' : 'Últimas 100 operações. O histórico completo de uma pergunta está no botão Histórico, ao editá-la.'));
}

arrancar().catch((e) => mostra(h('div', { class: 'erro' }, 'Erro ao arrancar: ' + msgErro(e))));
