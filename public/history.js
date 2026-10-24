const DB_NAME = 'dark-forest-history';
const DB_VERSION = 1;
const STORE = 'matches';
const LS_KEY = 'dark-forest-history-v1';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB tx aborted'));
  });
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // 本地存储已满或不可用；回放仍然可以看，只是不持久化
  }
}

export async function saveReplay(record) {
  if (!record || !record.id) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await txDone(tx);
    db.close();
  } catch {
    const list = readLocal().filter((r) => r.id !== record.id);
    list.push(record);
    writeLocal(list);
  }
}

export async function listReplays() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    const rows = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error ?? new Error('list failed'));
    });
    await txDone(tx);
    db.close();
    return rows.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  } catch {
    return readLocal().sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  }
}

export async function getReplay(id) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    const row = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error ?? new Error('get failed'));
    });
    await txDone(tx);
    db.close();
    return row;
  } catch {
    return readLocal().find((r) => r.id === id) ?? null;
  }
}

export async function deleteReplay(id) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
    db.close();
  } catch {
    writeLocal(readLocal().filter((r) => r.id !== id));
  }
}
