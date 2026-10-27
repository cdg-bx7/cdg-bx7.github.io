// Service worker de la Libreta (F1-18 y F1-24).
// Solo sirve los archivos de la propia app desde su caché, para que abra sin conexión. No hace peticiones por su
// cuenta ni toca tus datos: esos viven cifrados en el almacenamiento del navegador, no aquí.
//
// Actualizaciones bajo control: cuando se publica una versión, el navegador descarga este archivo y la app nueva
// en una caché aparte, pero la página sigue saliendo de la caché de la versión APROBADA. Solo cambia cuando pulsas
// «Actualizar» en Ajustes. Aunque el navegador active este service worker por su cuenta (al cerrar la app), sigue
// sirviendo la versión aprobada.
// VERSION tiene que coincidir con APP_VERSION de index.html (lo comprueba tests/sw.test.mjs).
const VERSION = '1.1.0';
const PREFIJO = 'libreta-', CACHE = PREFIJO + VERSION, CONTROL = PREFIJO + 'control';
const ARCHIVOS = ['./', 'index.html', 'manifest.webmanifest', 'icon.png'];
const ALCANCE = new URL(self.registration.scope);
const RUTAS = new Set(ARCHIVOS.map(u => new URL(u, ALCANCE).pathname));
const INDEX = new URL('index.html', ALCANCE).href, PUNTERO = new URL('__version-aprobada', ALCANCE).href;

const aprobada = () => caches.open(CONTROL).then(c => c.match(PUNTERO)).then(r => r ? r.text() : null);
const aprobar = v => caches.open(CONTROL).then(c => c.put(PUNTERO, new Response(v)));
// borra las cachés de versiones que ni están aprobadas ni son la de este service worker
const limpiar = v => caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIJO) && k !== CONTROL && k !== PREFIJO + v && k !== CACHE).map(k => caches.delete(k))));

self.addEventListener('install', e => {
  // cache:'reload' salta la caché HTTP del navegador: se guarda exactamente lo publicado
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  // la primera vez, la versión aprobada es esta (es la que ya estás usando); después, no se toca
  e.waitUntil(aprobada().then(v => v ? v : aprobar(VERSION).then(() => VERSION)).then(limpiar).then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  const d = e.data || {}, puerto = e.ports && e.ports[0];
  if(d.tipo === 'version') e.waitUntil(aprobada().then(v => { if(puerto) puerto.postMessage({ version: VERSION, aprobada: v || VERSION }); }));
  if(d.tipo === 'actualizar') e.waitUntil(aprobar(VERSION).then(() => limpiar(VERSION)).then(() => {
    self.skipWaiting();   // si este service worker está en espera, toma el control; si ya está activo, no hace nada
    if(puerto) puerto.postMessage({ ok: true, version: VERSION });
  }));
});

// Si faltara la copia en caché (el sistema la ha borrado), el service worker se da de baja y la página se
// recarga desde la red: así nunca deja la app sin abrir.
function recuperar(){
  return self.registration.unregister().then(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>Libreta</title><p style="font:16px system-ui;padding:24px">Recargando la Libreta…</p>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin || !RUTAS.has(url.pathname)) return;   // lo demás, como si no hubiera service worker
  const navegacion = req.mode === 'navigate';
  e.respondWith(aprobada()
    .then(v => caches.open(PREFIJO + (v || VERSION)))
    .then(c => c.match(navegacion ? INDEX : req, { ignoreSearch: true }))
    .then(r => r || (navegacion ? recuperar() : Response.error())));
});
