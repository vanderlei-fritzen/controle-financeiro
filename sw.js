// Service worker: faz o app abrir sem internet.
//
// Estratégia "rede primeiro": com conexão, sempre busca a versão mais nova e a guarda;
// sem conexão (ou com a rede lenta demais), usa a última versão guardada no aparelho.
// Só os arquivos do app passam por aqui. Os dados financeiros ficam no IndexedDB.

const CACHE = 'controle-financeiro-v1';
const ARQUIVOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './dados.js',
  './manifest.webmanifest',
  './icones/icone.svg',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-maskable-512.png',
];
const ESPERA_REDE_MS = 4000;

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((nome) => nome !== CACHE).map((nome) => caches.delete(nome))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (ev) => {
  const { request } = ev;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  ev.respondWith(redePrimeiro(request));
});

async function redePrimeiro(request) {
  const cache = await caches.open(CACHE);
  try {
    // Pela URL, e não pelo objeto request: pedidos de navegação não aceitam opções extras.
    const resposta = await fetch(request.url, { cache: 'no-cache', signal: AbortSignal.timeout(ESPERA_REDE_MS) });
    if (resposta.ok) cache.put(request.url, resposta.clone());
    return resposta;
  } catch {
    const guardada = await cache.match(request.url, { ignoreSearch: true });
    if (guardada) return guardada;
    // Qualquer endereço de página dentro do app cai na tela inicial guardada.
    const inicial = request.mode === 'navigate' ? await cache.match('./index.html') : undefined;
    return inicial ?? Response.error();
  }
}
