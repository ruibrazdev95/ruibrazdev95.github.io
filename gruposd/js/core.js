// Lógica do backoffice das apps do Grupo SD.
// Não importa o Firebase: recebe as funções do Firestore em `fs`, para correr igual no browser e nos testes.
//   fs = { db, doc, collection, getDoc, getDocs, setDoc, addDoc, deleteDoc, runTransaction, writeBatch, query, orderBy, limit }

export const APPS = {
  adrbase: { nome: 'Testes ADR Base SD', porTeste: 25, nResp: 3 },
  adrcisternas: { nome: 'Testes ADR Cisternas SD', porTeste: 15, nResp: 3 },
  adrexplosivos: { nome: 'Testes ADR Explosivos SD', porTeste: 15, nResp: 3 },
  cam: { nome: 'Testes CAM SD', porTeste: 60, nResp: 4 },
};

export const TAM_BLOCO = 200;   // perguntas por documento de rascunho
export const TAM_PARTE = 250;   // perguntas por parte publicada
export const VERSOES_GUARDADAS = 5;

const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const copia = (o) => JSON.parse(JSON.stringify(o));

/** Devolve a pergunta só com os campos guardados e textos sem espaços a mais. */
export function normalizar(p) {
  return {
    id: Number(p.id),
    t: limpa(p.t),
    r: (p.r || []).map((r) => ({ id: Number(r.id), t: limpa(r.t), c: !!r.c })),
    ativa: p.ativa !== false,
  };
}

/** Problemas que impedem a publicação. Só olha para as perguntas ativas. */
export function validar(appId, perguntas) {
  const cfg = APPS[appId];
  const problemas = [];
  const ids = new Set();
  const idsResp = new Set();
  const ativas = perguntas.filter((p) => p.ativa !== false);
  for (const p of perguntas) {
    if (ids.has(p.id)) problemas.push({ id: p.id, problema: 'Número de pergunta repetido.' });
    ids.add(p.id);
    for (const r of p.r || []) {
      if (idsResp.has(r.id)) problemas.push({ id: p.id, problema: `Número de resposta repetido (${r.id}).` });
      idsResp.add(r.id);
    }
  }
  for (const p of ativas) {
    if (!limpa(p.t)) problemas.push({ id: p.id, problema: 'A pergunta não tem texto.' });
    if ((p.r || []).length !== cfg.nResp) problemas.push({ id: p.id, problema: `Tem ${(p.r || []).length} respostas; esta app precisa de ${cfg.nResp}.` });
    const certas = (p.r || []).filter((r) => r.c).length;
    if (certas !== 1) problemas.push({ id: p.id, problema: certas === 0 ? 'Nenhuma resposta está marcada como certa.' : `Tem ${certas} respostas marcadas como certas.` });
    if ((p.r || []).some((r) => !limpa(r.t))) problemas.push({ id: p.id, problema: 'Há uma resposta sem texto.' });
  }
  if (ativas.length < cfg.porTeste) problemas.push({ id: 0, problema: `Só há ${ativas.length} perguntas ativas; cada teste precisa de ${cfg.porTeste}.` });
  return problemas;
}

/** Avisos que não impedem a publicação. */
export function avisos(perguntas) {
  const vistos = new Map();
  const out = [];
  for (const p of perguntas.filter((x) => x.ativa !== false)) {
    const k = limpa(p.t).toLowerCase();
    if (vistos.has(k)) out.push({ id: p.id, problema: `Texto igual ao da pergunta ${vistos.get(k)}.` });
    else vistos.set(k, p.id);
    const textos = (p.r || []).map((r) => limpa(r.t).toLowerCase());
    if (new Set(textos).size !== textos.length) out.push({ id: p.id, problema: 'Tem respostas com o mesmo texto.' });
  }
  return out;
}

/** Divide as perguntas ativas em partes para publicar. Cada parte é um texto JSON. */
export function construirPartes(versao, perguntas) {
  const ativas = perguntas.filter((p) => p.ativa !== false).map(normalizar).sort((a, b) => a.id - b.id);
  const partes = [];
  for (let i = 0; i < ativas.length; i += TAM_PARTE) {
    const p = ativas.slice(i, i + TAM_PARTE).map((q) => ({ id: q.id, t: q.t, r: q.r.map((r) => ({ id: r.id, t: r.t, c: r.c ? 1 : 0 })) }));
    partes.push(JSON.stringify({ v: versao, p }));
  }
  return { partes, total: ativas.length };
}

const refApp = (fs, app) => fs.doc(fs.db, 'apps', app);
const refBloco = (fs, app, i) => fs.doc(fs.db, 'apps', app, 'blocos', String(i));
const refPub = (fs, app) => fs.doc(fs.db, 'publicado', app);
const refParte = (fs, app, versao, i) => fs.doc(fs.db, 'publicado', app, 'partes', `${versao}_${i}`);
const colHist = (fs, app) => fs.collection(fs.db, 'apps', app, 'historico');

/** Lê o rascunho de uma app. Devolve null se a app ainda não tiver base carregada. */
export async function carregar(fs, app) {
  const m = await fs.getDoc(refApp(fs, app));
  if (!m.exists()) return null;
  const meta = m.data();
  const perguntas = [];
  const docs = await Promise.all(Array.from({ length: meta.blocos }, (_, i) => fs.getDoc(refBloco(fs, app, i))));
  docs.forEach((d, i) => { for (const p of (d.exists() ? d.data().perguntas : [])) perguntas.push({ ...p, _bloco: i }); });
  perguntas.sort((a, b) => a.id - b.id);
  return { meta, perguntas };
}

/** Escreve um conjunto completo de perguntas como rascunho (carregar a base inicial ou repor uma versão). */
async function escreverRascunho(fs, app, perguntas, quem, extra = {}) {
  const lista = perguntas.map(normalizar).sort((a, b) => a.id - b.id);
  const anterior = await fs.getDoc(refApp(fs, app));
  const blocosAntes = anterior.exists() ? anterior.data().blocos : 0;
  const nBlocos = Math.max(1, Math.ceil(lista.length / TAM_BLOCO));
  const batch = fs.writeBatch(fs.db);
  for (let i = 0; i < nBlocos; i++) batch.set(refBloco(fs, app, i), { perguntas: lista.slice(i * TAM_BLOCO, (i + 1) * TAM_BLOCO) });
  for (let i = nBlocos; i < blocosAntes; i++) batch.delete(refBloco(fs, app, i));
  const meta = {
    ...(anterior.exists() ? anterior.data() : { publicadoVersao: 0, publicadoEm: 0 }),
    nome: APPS[app].nome, porTeste: APPS[app].porTeste, nResp: APPS[app].nResp,
    blocos: nBlocos, total: lista.length,
    maxId: lista.reduce((m, p) => Math.max(m, p.id), 0),
    maxRespId: lista.reduce((m, p) => Math.max(m, ...p.r.map((r) => r.id)), 0),
    alteradoEm: Date.now(), alteradoPor: quem, ...extra,
  };
  batch.set(refApp(fs, app), meta);
  await batch.commit();
  return meta;
}

/** Carrega a base inicial (as perguntas que hoje estão dentro da app). Só funciona se a app ainda estiver vazia. */
export async function importarBase(fs, app, seed, quem) {
  if ((await fs.getDoc(refApp(fs, app))).exists()) throw new Error('Esta app já tem perguntas carregadas.');
  const perguntas = seed.perguntas.map((p) => ({ ...p, ativa: true }));
  const meta = await escreverRascunho(fs, app, perguntas, quem);
  await fs.addDoc(colHist(fs, app), { quando: Date.now(), quem, tipo: 'importar', id: 0, nota: `${perguntas.length} perguntas da base inicial` });
  return meta;
}

/**
 * Guarda uma pergunta (nova se não tiver id). Devolve a pergunta guardada.
 * Numa pergunta nova, o número da pergunta e os das respostas são atribuídos aqui.
 */
export async function guardarPergunta(fs, app, pergunta, quem) {
  const guardada = await fs.runTransaction(fs.db, async (tx) => {
    const m = await tx.get(refApp(fs, app));
    if (!m.exists()) throw new Error('Esta app ainda não tem base carregada.');
    const meta = m.data();
    let p = normalizar(pergunta);
    let antes = null;
    let bloco;
    let lista;
    if (!pergunta.id) {
      p.id = meta.maxId + 1;
      p.r = p.r.map((r, i) => ({ ...r, id: meta.maxRespId + 1 + i }));
      bloco = meta.blocos - 1;
      const b = await tx.get(refBloco(fs, app, bloco));
      lista = b.exists() ? b.data().perguntas : [];
      if (lista.length >= TAM_BLOCO) { bloco = meta.blocos; lista = []; }
      lista = [...lista, p];
      meta.maxId = p.id;
      meta.maxRespId += p.r.length;
      meta.total += 1;
      meta.blocos = Math.max(meta.blocos, bloco + 1);
    } else {
      bloco = pergunta._bloco;
      const b = await tx.get(refBloco(fs, app, bloco));
      lista = b.exists() ? [...b.data().perguntas] : [];
      const i = lista.findIndex((x) => x.id === p.id);
      if (i < 0) throw new Error('A pergunta já não está onde estava. Atualize a página e tente outra vez.');
      antes = lista[i];
      // os números das respostas existentes não mudam; respostas acrescentadas recebem número novo
      const conhecidos = new Set(antes.r.map((r) => r.id));
      p.r = p.r.map((r) => (conhecidos.has(r.id) ? r : { ...r, id: ++meta.maxRespId }));
      if (JSON.stringify(antes) === JSON.stringify(p)) return { ...p, _bloco: bloco, _igual: true };
      lista[i] = p;
    }
    meta.alteradoEm = Date.now();
    meta.alteradoPor = quem;
    tx.set(refBloco(fs, app, bloco), { perguntas: lista });
    tx.set(refApp(fs, app), meta);
    tx.set(fs.doc(colHist(fs, app)), { quando: meta.alteradoEm, quem, tipo: antes ? 'editar' : 'criar', id: p.id, antes, depois: p });
    return { ...p, _bloco: bloco };
  });
  return guardada;
}

/** Publica o rascunho: valida, escreve as partes da versão nova e só no fim muda o número da versão. */
export async function publicar(fs, app, quem, nota = '') {
  const estado = await carregar(fs, app);
  if (!estado) throw new Error('Esta app ainda não tem base carregada.');
  const problemas = validar(app, estado.perguntas);
  if (problemas.length) {
    const e = new Error(`Não é possível publicar: ${problemas.length} problema(s) por resolver.`);
    e.problemas = problemas;
    throw e;
  }
  const pub = await fs.getDoc(refPub(fs, app));
  const versao = (pub.exists() ? pub.data().versao : 0) + 1;
  const { partes, total } = construirPartes(versao, estado.perguntas);
  // 1) partes (ainda invisíveis para as apps, que só olham para a versão indicada no documento principal)
  for (let i = 0; i < partes.length; i += 20) {
    const batch = fs.writeBatch(fs.db);
    partes.slice(i, i + 20).forEach((json, k) => batch.set(refParte(fs, app, versao, i + k), { versao, i: i + k, json }));
    await batch.commit();
  }
  // 2) registo da versão e mudança da versão publicada
  const agora = Date.now();
  const batch = fs.writeBatch(fs.db);
  batch.set(fs.doc(fs.db, 'apps', app, 'versoes', String(versao)), { versao, partes: partes.length, total, publicadoEm: agora, quem, nota });
  batch.set(refPub(fs, app), { versao, partes: partes.length, total, publicadoEm: agora });
  batch.set(refApp(fs, app), { ...estado.meta, publicadoVersao: versao, publicadoEm: agora });
  batch.set(fs.doc(colHist(fs, app)), { quando: agora, quem, tipo: 'publicar', id: 0, nota: `versão ${versao} (${total} perguntas)${nota ? ': ' + nota : ''}` });
  await batch.commit();
  // 3) apaga partes de versões antigas
  const velha = versao - VERSOES_GUARDADAS;
  if (velha >= 1) {
    const v = await fs.getDoc(fs.doc(fs.db, 'apps', app, 'versoes', String(velha)));
    if (v.exists()) {
      const b = fs.writeBatch(fs.db);
      for (let i = 0; i < v.data().partes; i++) b.delete(refParte(fs, app, velha, i));
      await b.commit();
    }
  }
  return { versao, total, partes: partes.length };
}

/** Lê as perguntas de uma versão publicada (como as apps as recebem). */
export async function lerPublicado(fs, app, versao) {
  const v = await fs.getDoc(fs.doc(fs.db, 'apps', app, 'versoes', String(versao)));
  if (!v.exists()) throw new Error('Versão desconhecida.');
  const perguntas = [];
  for (let i = 0; i < v.data().partes; i++) {
    const d = await fs.getDoc(refParte(fs, app, versao, i));
    if (!d.exists()) throw new Error('As perguntas desta versão já foram apagadas.');
    for (const p of JSON.parse(d.data().json).p) perguntas.push({ id: p.id, t: p.t, r: p.r.map((r) => ({ id: r.id, t: r.t, c: !!r.c })), ativa: true });
  }
  return perguntas;
}

/**
 * Volta a uma versão publicada anterior: o rascunho passa a ser o conteúdo dessa versão
 * (as perguntas que ela não tinha ficam inativas) e é publicado como versão nova.
 */
export async function reporVersao(fs, app, versao, quem) {
  const antigas = await lerPublicado(fs, app, versao);
  const estado = await carregar(fs, app);
  const mapa = new Map(antigas.map((p) => [p.id, p]));
  const perguntas = estado.perguntas.map((p) => (mapa.has(p.id) ? mapa.get(p.id) : { ...normalizar(p), ativa: false }));
  for (const p of antigas) if (!estado.perguntas.some((x) => x.id === p.id)) perguntas.push(p);
  await escreverRascunho(fs, app, perguntas, quem);
  await fs.addDoc(colHist(fs, app), { quando: Date.now(), quem, tipo: 'repor', id: 0, nota: `rascunho reposto com a versão ${versao}` });
  return publicar(fs, app, quem, `reposição da versão ${versao}`);
}

export async function listarVersoes(fs, app) {
  const s = await fs.getDocs(fs.query(fs.collection(fs.db, 'apps', app, 'versoes'), fs.orderBy('versao', 'desc'), fs.limit(20)));
  return s.docs.map((d) => d.data());
}

export async function historico(fs, app, n = 100) {
  const s = await fs.getDocs(fs.query(colHist(fs, app), fs.orderBy('quando', 'desc'), fs.limit(n)));
  return s.docs.map((d) => d.data());
}

/** Perguntas alteradas no rascunho desde a última publicação (para mostrar o que vai mudar). */
export function diferencas(rascunho, publicadas) {
  const pub = new Map(publicadas.map((p) => [p.id, JSON.stringify({ t: p.t, r: p.r })]));
  const out = [];
  for (const p of rascunho) {
    const q = normalizar(p);
    const k = JSON.stringify({ t: q.t, r: q.r });
    if (q.ativa && !pub.has(q.id)) out.push({ id: q.id, tipo: 'nova' });
    else if (!q.ativa && pub.has(q.id)) out.push({ id: q.id, tipo: 'retirada' });
    else if (q.ativa && pub.get(q.id) !== k) out.push({ id: q.id, tipo: 'alterada' });
  }
  return out;
}

// ---------- comparar, duplicados e alterações em conjunto ----------

/** Texto reduzido ao essencial para comparar: sem acentos, sem pontuação, sem maiúsculas. */
export const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const parDe = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const assinatura = (p) => (p.r || []).map((r) => `${r.c ? '1' : '0'}${chave(r.t)}`).sort().join('|');
const certaDe = (p) => (p.r || []).filter((r) => r.c).map((r) => chave(r.t)).sort().join('|');

/** Semelhança entre dois textos, de 0 a 1 (palavras em comum). */
export function semelhanca(a, b) {
  const x = chave(a).split(' ').filter(Boolean);
  const y = chave(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return 0;
  const conta = new Map();
  for (const w of x) conta.set(w, (conta.get(w) || 0) + 1);
  let comuns = 0;
  for (const w of y) { const n = conta.get(w) || 0; if (n > 0) { comuns++; conta.set(w, n - 1); } }
  return (2 * comuns) / (x.length + y.length);
}

function componentes(ids, arestas) {
  const pai = new Map(ids.map((i) => [i, i]));
  const raiz = (i) => { while (pai.get(i) !== i) { pai.set(i, pai.get(pai.get(i))); i = pai.get(i); } return i; };
  for (const [a, b] of arestas) pai.set(raiz(a), raiz(b));
  const g = new Map();
  for (const i of ids) { const r = raiz(i); g.set(r, [...(g.get(r) || []), i]); }
  return [...g.values()].filter((v) => v.length > 1).map((v) => v.sort((a, b) => a - b));
}

/**
 * Procura perguntas ativas repetidas.
 * Devolve { grupos: [{ tipo, ids }], respostasRepetidas: [id] }.
 *   tipo 'iguais'          — mesmo texto e mesmas respostas (a mesma certa)
 *   tipo 'mesma_certa'     — mesmo texto e mesma resposta certa, respostas erradas diferentes
 *   tipo 'certa_diferente' — mesmo texto mas resposta certa diferente
 *   tipo 'parecidas'       — texto quase igual (só com opcoes.parecidas)
 * `ignorados` são pares "a-b" já marcados como perguntas diferentes.
 */
export function duplicados(perguntas, ignorados = [], opcoes = {}) {
  const ign = new Set(ignorados);
  const ativas = perguntas.filter((p) => p.ativa !== false);
  const porId = new Map(ativas.map((p) => [p.id, p]));
  const porChave = new Map();
  for (const p of ativas) { const k = chave(p.t); if (k) porChave.set(k, [...(porChave.get(k) || []), p.id]); }
  const grupos = [];
  for (const ids of porChave.values()) {
    if (ids.length < 2) continue;
    const arestas = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (!ign.has(parDe(ids[i], ids[j]))) arestas.push([ids[i], ids[j]]);
    for (const g of componentes(ids, arestas)) {
      const ps = g.map((i) => porId.get(i));
      const tipo = new Set(ps.map(assinatura)).size === 1 ? 'iguais' : (new Set(ps.map(certaDe)).size === 1 ? 'mesma_certa' : 'certa_diferente');
      grupos.push({ tipo, ids: g });
    }
  }
  if (opcoes.parecidas) {
    const limiar = opcoes.limiar ?? 0.85;
    const lista = ativas.map((p) => ({ id: p.id, k: chave(p.t), n: chave(p.t).split(' ').length })).filter((x) => x.n >= 4);
    const arestas = [];
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i]; const b = lista[j];
        if (a.k === b.k || ign.has(parDe(a.id, b.id))) continue;
        if ((2 * Math.min(a.n, b.n)) / (a.n + b.n) < limiar) continue;   // nem com todas as palavras em comum lá chegava
        if (semelhanca(a.k, b.k) >= limiar) arestas.push([a.id, b.id]);
      }
    }
    for (const g of componentes(lista.map((x) => x.id), arestas)) grupos.push({ tipo: 'parecidas', ids: g });
  }
  const respostasRepetidas = ativas.filter((p) => { const t = (p.r || []).map((r) => chave(r.t)); return new Set(t).size !== t.length; }).map((p) => p.id);
  grupos.sort((a, b) => a.ids[0] - b.ids[0]);
  return { grupos, respostasRepetidas };
}

/** Diferenças palavra a palavra entre dois textos: [{ t, tipo }] com tipo '=', '+' (só no segundo) ou '-' (só no primeiro). */
export function difPalavras(a, b) {
  const x = limpa(a).split(' ').filter(Boolean);
  const y = limpa(b).split(' ').filter(Boolean);
  const m = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) m[i][j] = x[i] === y[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
  const out = [];
  const poe = (t, tipo) => { const u = out[out.length - 1]; if (u && u.tipo === tipo) u.t += ' ' + t; else out.push({ t, tipo }); };
  let i = 0; let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { poe(x[i], '='); i++; j++; } else if (m[i + 1][j] >= m[i][j + 1]) poe(x[i++], '-'); else poe(y[j++], '+');
  }
  while (i < x.length) poe(x[i++], '-');
  while (j < y.length) poe(y[j++], '+');
  return out;
}

/**
 * Prepara um "localizar e substituir" sem gravar nada. Devolve as perguntas que mudariam: [{ id, antes, depois, vezes }].
 * onde: 'tudo' | 'perguntas' | 'respostas'. Só mexe em perguntas ativas, a não ser que opcoes.inativas seja true.
 */
export function substituir(perguntas, de, para, opcoes = {}) {
  if (!de) return [];
  const onde = opcoes.onde || 'tudo';
  const re = new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opcoes.maiusculas === false ? 'gi' : 'g');
  const out = [];
  for (const p of perguntas) {
    if (p.ativa === false && !opcoes.inativas) continue;
    let vezes = 0;
    const troca = (s) => s.replace(re, () => { vezes++; return para; });
    const antes = normalizar(p);
    const depois = normalizar({ ...antes, t: onde === 'respostas' ? antes.t : troca(antes.t), r: antes.r.map((r) => ({ ...r, t: onde === 'perguntas' ? r.t : troca(r.t) })) });
    if (vezes && JSON.stringify(antes) !== JSON.stringify(depois)) out.push({ id: p.id, antes, depois, vezes });
  }
  return out;
}

export const MAX_POR_LOTE = 150;

/**
 * Altera várias perguntas de uma vez, numa só transação (no máximo MAX_POR_LOTE; use alterarEmLotes para mais).
 * Cada operação é uma de:
 *   { id, ativa: true|false }   ativa ou desativa
 *   { id, apagar: true }        tira a pergunta do rascunho (fica no histórico, de onde pode ser reposta)
 *   { id, por: pergunta }       substitui o conteúdo; se a pergunta já não existir, volta a criá-la com o mesmo número
 * `tipo` (opcional) é o nome que fica no histórico em vez do habitual.
 */
export async function alterarVarias(fs, app, ops, quem, tipo = null) {
  if (ops.length > MAX_POR_LOTE) throw new Error(`No máximo ${MAX_POR_LOTE} perguntas de cada vez.`);
  return fs.runTransaction(fs.db, async (tx) => {
    const m = await tx.get(refApp(fs, app));
    if (!m.exists()) throw new Error('Esta app ainda não tem base carregada.');
    const meta = m.data();
    const blocos = [];
    for (let i = 0; i < meta.blocos; i++) { const b = await tx.get(refBloco(fs, app, i)); blocos.push(b.exists() ? [...b.data().perguntas] : []); }
    const mexidos = new Set();
    const registos = [];
    for (const op of ops) {
      const id = Number(op.id);
      let b = blocos.findIndex((l) => l.some((x) => x.id === id));
      const i = b < 0 ? -1 : blocos[b].findIndex((x) => x.id === id);
      const antes = i < 0 ? null : blocos[b][i];
      let depois;
      let nome;
      if (op.apagar) {
        if (!antes) continue;
        blocos[b].splice(i, 1); depois = null; nome = 'apagar'; meta.total -= 1;
      } else if (op.por) {
        depois = { ...normalizar(op.por), id };
        if (antes) { blocos[b][i] = depois; nome = 'editar'; } else {
          b = blocos.length - 1;
          if (b < 0 || blocos[b].length >= TAM_BLOCO) { blocos.push([]); b = blocos.length - 1; }
          blocos[b].push(depois); nome = 'repor'; meta.total += 1;
          meta.maxId = Math.max(meta.maxId, id);
          meta.maxRespId = Math.max(meta.maxRespId, ...depois.r.map((r) => r.id));
        }
      } else {
        if (!antes) continue;
        depois = { ...antes, ativa: !!op.ativa }; blocos[b][i] = depois; nome = op.ativa ? 'ativar' : 'desativar';
      }
      if (antes && depois && JSON.stringify(antes) === JSON.stringify(depois)) continue;
      mexidos.add(b);
      registos.push({ tipo: tipo || nome, id, antes, depois });
    }
    if (!registos.length) return { feitas: 0 };
    meta.blocos = blocos.length;
    meta.alteradoEm = Date.now();
    meta.alteradoPor = quem;
    for (const b of mexidos) tx.set(refBloco(fs, app, b), { perguntas: blocos[b] });
    tx.set(refApp(fs, app), meta);
    for (const r of registos) tx.set(fs.doc(colHist(fs, app)), { quando: meta.alteradoEm, quem, ...r });
    return { feitas: registos.length };
  });
}

export async function alterarEmLotes(fs, app, ops, quem, tipo = null) {
  let feitas = 0;
  for (let i = 0; i < ops.length; i += MAX_POR_LOTE) feitas += (await alterarVarias(fs, app, ops.slice(i, i + MAX_POR_LOTE), quem, tipo)).feitas;
  return { feitas };
}

/** Regista que estas perguntas, apesar de parecidas, são perguntas diferentes (deixam de aparecer nos duplicados). */
export async function marcarDiferentes(fs, app, ids) {
  return fs.runTransaction(fs.db, async (tx) => {
    const m = await tx.get(refApp(fs, app));
    const meta = m.data();
    const s = new Set(meta.naoDuplicados || []);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) s.add(parDe(ids[i], ids[j]));
    meta.naoDuplicados = [...s];
    tx.set(refApp(fs, app), meta);
    return meta;
  });
}

/** Histórico de uma pergunta (mais recente primeiro). */
export async function historicoPergunta(fs, app, id) {
  const s = await fs.getDocs(fs.query(colHist(fs, app), fs.where('id', '==', Number(id))));
  return s.docs.map((d) => d.data()).sort((a, b) => b.quando - a.quando);
}

/** Últimas perguntas apagadas (para repor). */
export async function apagadas(fs, app) {
  const s = await fs.getDocs(fs.query(colHist(fs, app), fs.where('tipo', '==', 'apagar')));
  return s.docs.map((d) => d.data()).sort((a, b) => b.quando - a.quando);
}

export { copia };
