// ===== CONFIGURACIÓN =====
const RADIO_METROS = 3000;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CLAVE_FAV = 'saludCerca.favoritos';
const CLAVE_FILTRO = 'saludCerca.filtro';
const CLAVE_TEMA = 'saludCerca.tema';

// ===== ESTADO =====
let mapa, marcadorUsuario, capaMarcadores;
let ubicacionActual = null;
let todosLosResultados = [];
let filtroActivo = 'todos';
let textoBusqueda = '';
let favoritos = {};

// ===== INICIALIZACIÓN =====
document.addEventListener('DOMContentLoaded', () => {
  cargarFavoritos();
  cargarTema();
  inicializarMapa();
  configurarFiltros();
  configurarBotones();
  actualizarContadorFav();
  obtenerUbicacion();
});

function inicializarMapa() {
  mapa = L.map('mapa').setView([19.4326, -99.1332], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(mapa);
  capaMarcadores = L.layerGroup().addTo(mapa);
}

// ===== TEMA OSCURO =====
function cargarTema() {
  const guardado = localStorage.getItem(CLAVE_TEMA);
  const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const oscuro = guardado ? guardado === 'oscuro' : prefiereOscuro;
  aplicarTema(oscuro);
}

function aplicarTema(oscuro) {
  document.body.classList.toggle('oscuro', oscuro);
  document.getElementById('btn-tema').textContent = oscuro ? '☀️' : '🌙';
  document.getElementById('btn-tema').title = oscuro ? 'Modo claro' : 'Modo oscuro';
  localStorage.setItem(CLAVE_TEMA, oscuro ? 'oscuro' : 'claro');
}

function alternarTema() {
  aplicarTema(!document.body.classList.contains('oscuro'));
}

// ===== FILTROS =====
function configurarFiltros() {
  const botones = document.querySelectorAll('#filtros button');
  const guardado = localStorage.getItem(CLAVE_FILTRO);
  if (guardado) {
    filtroActivo = guardado;
    botones.forEach(b => b.classList.toggle('activo', b.dataset.tipo === guardado));
  }

  botones.forEach(btn => {
    btn.addEventListener('click', () => {
      botones.forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      filtroActivo = btn.dataset.tipo;
      localStorage.setItem(CLAVE_FILTRO, filtroActivo);
      renderizar();
    });
  });
}

// ===== BOTONES =====
function configurarBotones() {
  // Refresh
  const btnRefresh = document.getElementById('btn-refresh');
  btnRefresh.addEventListener('click', () => {
    if (!ubicacionActual) { obtenerUbicacion(); return; }
    btnRefresh.classList.add('girando');
    buscarServicios().finally(() => {
      setTimeout(() => btnRefresh.classList.remove('girando'), 400);
    });
  });

  // Tema
  document.getElementById('btn-tema').addEventListener('click', alternarTema);

  // Buscador
  const buscador = document.getElementById('buscador');
  buscador.addEventListener('input', (e) => {
    textoBusqueda = e.target.value.trim().toLowerCase();
    renderizar();
  });

  // Modal favoritos
  document.getElementById('btn-ver-fav').addEventListener('click', abrirModalFav);
  document.getElementById('cerrar-modal').addEventListener('click', cerrarModalFav);
  document.getElementById('modal-fav').addEventListener('click', (e) => {
    if (e.target.id === 'modal-fav') cerrarModalFav();
  });

  // Menú cómo llegar
  document.getElementById('cerrar-menu-llegar').addEventListener('click', cerrarMenuLlegar);
  document.getElementById('menu-llegar').addEventListener('click', (e) => {
    if (e.target.id === 'menu-llegar') cerrarMenuLlegar();
  });
}

// ===== GEOLOCALIZACIÓN =====
function obtenerUbicacion() {
  if (!navigator.geolocation) {
    document.getElementById('estado').textContent = '❌ Tu navegador no soporta geolocalización.';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ubicacionActual = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      mapa.setView([ubicacionActual.lat, ubicacionActual.lon], 15);

      if (marcadorUsuario) mapa.removeLayer(marcadorUsuario);
      marcadorUsuario = L.marker([ubicacionActual.lat, ubicacionActual.lon], {
        icon: L.divIcon({
          className: 'mi-ubicacion',
          html: '<div style="background:#0d9488;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.4);"></div>',
          iconSize: [22, 22], iconAnchor: [11, 11]
        })
      }).addTo(mapa).bindPopup('📍 Estás aquí');

      buscarServicios();
    },
    (err) => {
      const mensajes = {
        1: '❌ Permiso de ubicación denegado. Actívalo en tu navegador.',
        2: '❌ No se pudo obtener la ubicación. Verifica tu GPS.',
        3: '❌ Tiempo de espera agotado.'
      };
      document.getElementById('estado').textContent = mensajes[err.code] || '❌ Error de ubicación.';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ===== CONSULTA OVERPASS =====
function construirConsulta(lat, lon) {
  return `
    [out:json][timeout:30];
    (
      node["amenity"="pharmacy"](around:${RADIO_METROS},${lat},${lon});
      way["amenity"="pharmacy"](around:${RADIO_METROS},${lat},${lon});
      node["amenity"="hospital"](around:${RADIO_METROS},${lat},${lon});
      way["amenity"="hospital"](around:${RADIO_METROS},${lat},${lon});
      node["amenity"="clinic"](around:${RADIO_METROS},${lat},${lon});
      way["amenity"="clinic"](around:${RADIO_METROS},${lat},${lon});
      node["healthcare"="clinic"](around:${RADIO_METROS},${lat},${lon});
      way["healthcare"="clinic"](around:${RADIO_METROS},${lat},${lon});
      node["amenity"="doctors"](around:${RADIO_METROS},${lat},${lon});
      way["amenity"="doctors"](around:${RADIO_METROS},${lat},${lon});
      node["healthcare"="doctor"](around:${RADIO_METROS},${lat},${lon});
      way["healthcare"="doctor"](around:${RADIO_METROS},${lat},${lon});
      node["emergency"="ambulance_station"](around:${RADIO_METROS},${lat},${lon});
      way["emergency"="ambulance_station"](around:${RADIO_METROS},${lat},${lon});
      node["healthcare"="hospital"](around:${RADIO_METROS},${lat},${lon});
      way["healthcare"="hospital"](around:${RADIO_METROS},${lat},${lon});
    );
    out center tags 50;
  `;
}

async function buscarServicios() {
  if (!ubicacionActual) return;
  const estado = document.getElementById('estado');
  estado.textContent = '🔎 Buscando servicios de salud cercanos...';

  try {
    const query = construirConsulta(ubicacionActual.lat, ubicacionActual.lon);
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!res.ok) throw new Error('Error en la consulta');

    const data = await res.json();
    procesarResultados(data.elements || []);
  } catch (e) {
    estado.textContent = '⚠️ No se pudieron cargar los datos. Revisa tu conexión e intenta de nuevo.';
    console.error(e);
  }
}

// ===== PROCESAMIENTO =====
function procesarResultados(elementos) {
  todosLosResultados = [];

  elementos.forEach(el => {
    const lat = el.lat || (el.center && el.center.lat);
    const lon = el.lon || (el.center && el.center.lon);
    if (!lat || !lon) return;

    const tags = el.tags || {};
    let tipo = 'consultorio';

    if (tags.amenity === 'pharmacy' || tags.healthcare === 'pharmacy') tipo = 'farmacia';
    else if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') tipo = 'hospital';
    else if (tags.amenity === 'clinic' || tags.healthcare === 'clinic') tipo = 'clinica';
    else if (tags.emergency === 'ambulance_station') tipo = 'urgencias';
    else if (tags.amenity === 'doctors' || tags.healthcare === 'doctor' || tags.healthcare === 'general_practitioner') tipo = 'consultorio';

    const nombre = tags.name || tags.operator || 'Sin nombre';
    const direccion = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || tags['addr:full'] || 'Dirección no disponible';
    const telefono = tags.phone || tags['contact:phone'] || tags.mobile || '';
    const horario = tags.opening_hours || '';

    todosLosResultados.push({
      id: String(el.id), lat, lon, tipo, nombre, direccion, telefono, horario,
      distancia: calcularDistancia(ubicacionActual.lat, ubicacionActual.lon, lat, lon)
    });
  });

  todosLosResultados.sort((a, b) => a.distancia - b.distancia);
  renderizar();
}

function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatearDistancia(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`;
}

// ===== FAVORITOS =====
function cargarFavoritos() {
  try {
    favoritos = JSON.parse(localStorage.getItem(CLAVE_FAV) || '{}');
  } catch { favoritos = {}; }
}

function guardarFavoritos() {
  localStorage.setItem(CLAVE_FAV, JSON.stringify(favoritos));
}

function esFavorito(id) { return !!favoritos[id]; }

function alternarFavorito(r) {
  if (favoritos[r.id]) {
    delete favoritos[r.id];
  } else {
    favoritos[r.id] = {
      id: r.id, nombre: r.nombre, tipo: r.tipo,
      direccion: r.direccion, lat: r.lat, lon: r.lon,
      telefono: r.telefono || ''
    };
  }
  guardarFavoritos();
  actualizarContadorFav();
  renderizar();
}

function actualizarContadorFav() {
  const n = Object.keys(favoritos).length;
  document.getElementById('contador-fav').textContent = `⭐ ${n} favorito${n === 1 ? '' : 's'}`;
  document.getElementById('btn-ver-fav').disabled = n === 0;
}

// ===== RENDERIZADO =====
function renderizar() {
  const lista = document.getElementById('lista');
  const estado = document.getElementById('estado');
  capaMarcadores.clearLayers();

  let filtrados = todosLosResultados;

  if (filtroActivo !== 'todos') {
    filtrados = filtrados.filter(r => r.tipo === filtroActivo);
  }

  if (textoBusqueda) {
    filtrados = filtrados.filter(r => {
      const heno = `${r.nombre} ${r.direccion} ${etiquetaTipo(r.tipo)}`.toLowerCase();
      return heno.includes(textoBusqueda);
    });
  }

  if (todosLosResultados.length === 0) {
    estado.textContent = '😕 No se encontraron servicios de salud en un radio de 3 km.';
    lista.innerHTML = '';
    return;
  }

  if (filtrados.length === 0) {
    estado.textContent = textoBusqueda
      ? `🔍 No hay resultados para "${textoBusqueda}".`
      : `No hay resultados del tipo "${filtroActivo}" en esta zona.`;
    lista.innerHTML = '';
    return;
  }

  estado.textContent = `✅ ${filtrados.length} resultado(s) encontrado(s)`;

  lista.innerHTML = filtrados.map(r => {
    const fav = esFavorito(r.id);
    return `
    <div class="tarjeta ${fav ? 'favorita' : ''}">
      <button class="btn-fav ${fav ? '' : 'no-fav'}" data-id="${r.id}" title="${fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${fav ? '⭐' : '☆'}</button>
      <h3>${r.nombre}</h3>
      <span class="tipo">${etiquetaTipo(r.tipo)}</span>
      <div class="distancia">📏 ${formatearDistancia(r.distancia)}</div>
      <div class="direccion">📍 ${r.direccion}</div>
      ${r.telefono ? `<div class="telefono">📞 ${r.telefono}</div>` : ''}
      <div class="acciones">
        <a class="btn-ver-mapa" href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=18/${r.lat}/${r.lon}" target="_blank">🧭 Ver en mapa</a>
        <button class="btn-como-llegar" data-lat="${r.lat}" data-lon="${r.lon}" data-nombre="${escapeAttr(r.nombre)}">🚗 Cómo llegar</button>
        ${r.telefono ? `<a class="btn-llamar" href="tel:${r.telefono.replace(/[^0-9+]/g, '')}">📞 Llamar</a>` : ''}
      </div>
    </div>`;
  }).join('');

  lista.querySelectorAll('.btn-fav').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = todosLosResultados.find(x => x.id === btn.dataset.id);
      if (r) alternarFavorito(r);
    });
  });

  lista.querySelectorAll('.btn-como-llegar').forEach(btn => {
    btn.addEventListener('click', () => {
      abrirMenuLlegar(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon), btn.dataset.nombre);
    });
  });

  filtrados.forEach(r => {
    const color = r.tipo === 'farmacia' ? '#0d9488' :
                  r.tipo === 'hospital' ? '#dc2626' :
                  r.tipo === 'urgencias' ? '#ea580c' :
                  r.tipo === 'clinica' ? '#2563eb' : '#7c3aed';

    L.circleMarker([r.lat, r.lon], {
      radius: 8, fillColor: color, color: '#fff',
      weight: 2, opacity: 1, fillOpacity: 0.9
    }).addTo(capaMarcadores)
      .bindPopup(`<b>${r.nombre}</b><br>${etiquetaTipo(r.tipo)}<br>${formatearDistancia(r.distancia)}`);
  });
}

function etiquetaTipo(tipo) {
  const m = { farmacia: 'Farmacia', hospital: 'Hospital', clinica: 'Clínica', urgencias: 'Urgencias', consultorio: 'Consultorio' };
  return m[tipo] || tipo;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== MENÚ CÓMO LLEGAR =====
function abrirMenuLlegar(lat, lon, nombre) {
  const destino = `${lat},${lon}`;

  let googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=driving`;
  if (ubicacionActual) {
    googleUrl += `&origin=${ubicacionActual.lat},${ubicacionActual.lon}`;
  }

  const wazeUrl = `https://waze.com/ul?ll=${lat}%2C${lon}&navigate=yes`;

  const osmUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${ubicacionActual ? `${ubicacionActual.lat},${ubicacionActual.lon}` : ''};${lat},${lon}`;

  document.getElementById('link-google').href = googleUrl;
  document.getElementById('link-waze').href = wazeUrl;
  document.getElementById('link-osm').href = osmUrl;
  document.getElementById('menu-llegar-titulo').textContent = `Cómo llegar a: ${nombre || 'Destino'}`;
  document.getElementById('menu-llegar').classList.add('abierto');
  document.body.style.overflow = 'hidden';
}

function cerrarMenuLlegar() {
  document.getElementById('menu-llegar').classList.remove('abierto');
  document.body.style.overflow = '';
}

// ===== MODAL FAVORITOS =====
function abrirModalFav() {
  const listaFav = document.getElementById('lista-fav');
  const items = Object.values(favoritos);

  if (items.length === 0) {
    listaFav.innerHTML = '<div class="fav-vacio">Aún no tienes favoritos.<br>Toca la ⭐ en cualquier resultado para guardarlo aquí.</div>';
  } else {
    listaFav.innerHTML = items.map(f => `
      <div class="fav-item" data-id="${f.id}">
        <div style="flex:1">
          <h4>${f.nombre}</h4>
          <p>${etiquetaTipo(f.tipo)} · ${f.direccion}</p>
          ${f.telefono ? `<p>📞 ${f.telefono}</p>` : ''}
        </div>
        <div class="acciones">
          <button class="ver" data-accion="ver" data-id="${f.id}">Ver</button>
          <button class="llegar" data-accion="llegar" data-id="${f.id}">Llegar</button>
          ${f.telefono ? `<a class="llamar" href="tel:${f.telefono.replace(/[^0-9+]/g, '')}" style="text-decoration:none;text-align:center;padding:6px 10px;border-radius:8px;font-size:0.75rem;font-weight:600;">Llamar</a>` : ''}
          <button data-accion="quitar" data-id="${f.id}">Quitar</button>
        </div>
      </div>
    `).join('');

    listaFav.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const accion = btn.dataset.accion;
        const f = favoritos[id];

        if (accion === 'quitar') {
          delete favoritos[id];
          guardarFavoritos();
          actualizarContadorFav();
          renderizar();
          abrirModalFav();
        } else if (accion === 'llegar') {
          cerrarModalFav();
          abrirMenuLlegar(f.lat, f.lon, f.nombre);
        } else if (accion === 'ver') {
          cerrarModalFav();
          mapa.setView([f.lat, f.lon], 17);
          capaMarcadores.eachLayer(l => {
            const ll = l.getLatLng();
            if (Math.abs(ll.lat - f.lat) < 1e-6 && Math.abs(ll.lng - f.lon) < 1e-6) {
              l.openPopup();
            }
          });
        }
      });
    });
  }

  document.getElementById('modal-fav').classList.add('abierto');
  document.body.style.overflow = 'hidden';
}

function cerrarModalFav() {
  document.getElementById('modal-fav').classList.remove('abierto');
  document.body.style.overflow = '';
                                                          }
