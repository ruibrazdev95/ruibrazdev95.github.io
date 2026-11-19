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

export { copia };
