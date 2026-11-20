// Firestore de faz-de-conta, em memória, para o modo de demonstração (?demo=1) e para testar o ecrã sem tocar nos dados.
const dados = new Map();
const caminho = (...p) => p.join('/');
const ref = (path) => ({ path, id: path.split('/').pop() });
const snap = (r) => ({ exists: () => dados.has(r.path), data: () => JSON.parse(dados.get(r.path)), ref: r, id: r.id });
let n = 0;

export const fsMemoria = {
  db: {},
  doc: (a, ...p) => (a && a.col ? ref(caminho(a.col, p[0] ?? `auto${String(++n).padStart(6, '0')}`)) : ref(caminho(...p))),
  collection: (_db, ...p) => ({ col: caminho(...p) }),
  getDoc: async (r) => snap(r),
  setDoc: async (r, d) => { dados.set(r.path, JSON.stringify(d)); },
  addDoc: async (c, d) => { const r = ref(caminho(c.col, `auto${String(++n).padStart(6, '0')}`)); dados.set(r.path, JSON.stringify(d)); return r; },
  deleteDoc: async (r) => { dados.delete(r.path); },
  runTransaction: async (_db, f) => {
    const escritas = [];
    const res = await f({ get: async (r) => snap(r), set: (r, d) => escritas.push([r, d]) });
    escritas.forEach(([r, d]) => dados.set(r.path, JSON.stringify(d)));
    return res;
  },
  writeBatch: () => {
    const ops = [];
    return { set: (r, d) => ops.push(['s', r, d]), delete: (r) => ops.push(['d', r]), commit: async () => ops.forEach(([o, r, d]) => (o === 's' ? dados.set(r.path, JSON.stringify(d)) : dados.delete(r.path))) };
  },
  query: (c, ...mods) => ({ ...c, mods }),
  orderBy: (campo, dir = 'asc') => ({ campo, dir }),
  limit: (lim) => ({ lim }),
  where: (campoW, _op, valor) => ({ campoW, valor }),
  getDocs: async (q) => {
    let docs = [...dados.keys()].filter((k) => k.startsWith(q.col + '/') && !k.slice(q.col.length + 1).includes('/')).map((k) => snap(ref(k)));
    for (const m of q.mods || []) {
      if (m.campoW) docs = docs.filter((d) => d.data()[m.campoW] === m.valor);
      if (m.campo) docs.sort((a, b) => (a.data()[m.campo] - b.data()[m.campo]) * (m.dir === 'desc' ? -1 : 1));
      if (m.lim) docs = docs.slice(0, m.lim);
    }
    return { docs };
  },
};
