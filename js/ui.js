// HUD, menus, map, interaction prompts. Turkish user-facing text; English identifiers.

import * as THREE from 'three';
import { CAT_COLOR, contourSegments, drawPlanBase, drawContourArt, shortName } from './mapdraw.js';
import { buildPlaces } from './places.js';
import { pointInRing, clamp } from './util.js';
import { fmtShort, fmtDate, parseDate, addDays, dateKey } from './schedule.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const MAP_HX = 430; // half extents of the pre-rendered plan (metres)
const MAP_HZ = 260;
const BASE_PX = 3.2;
const SRC_LABEL = { osm: 'OSM', ieu: 'ieu.edu.tr', tim: 'tim.ieu.edu.tr', sfl: 'sfl.ieu.edu.tr', lib: 'kutuphane.ieu.edu.tr', dorm: 'yurt.ieu.edu.tr', wiki: 'Vikipedi', arkiv: 'arkiv.com.tr', kdr: 'kurumsal değerlendirme raporu 2020', tahmin: 'tahmin', foto: 'fotoğraftan tahmin' };
const CAT_LABEL = {
  academic: 'Akademik bina', dorm: 'Yurt', food: 'Yeme içme', venue: 'Etkinlik alanı', library: 'Kütüphane',
  green: 'Yeşil alan', transport: 'Ulaşım', gate: 'Kapı', other: 'Diğer',
};

const fmtClock = (h) => {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#14243b" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="#f28c28" stroke="#f28c28"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="#14243b"/></svg>';

export function initUI(sim) {
  const { data, hf, player, camera, sky, buildings, crowd, boundary } = sim;
  const ui = { menu: null, running: false, hud: true, labels: true, minimap: true, timeScale: 20, mmZoom: 150, ignoreUnlock: false };
  sim.ui = ui;

  const { places, groups } = buildPlaces({ data, buildings, navgrid: sim.navgrid, boundary });
  ui.places = places;

  // ------------------------------------------------------------------ maps
  const base = document.createElement('canvas');
  base.width = Math.round(2 * MAP_HX * BASE_PX);
  base.height = Math.round(2 * MAP_HZ * BASE_PX);
  const bctx = base.getContext('2d');
  bctx.setTransform(BASE_PX, 0, 0, BASE_PX, MAP_HX * BASE_PX, MAP_HZ * BASE_PX);
  const contours = contourSegments(hf, { xMin: -MAP_HX - 6, xMax: MAP_HX + 6, zMin: -MAP_HZ - 6, zMax: MAP_HZ + 6 }, 3, 2);
  drawPlanBase(bctx, data, contours, { xMin: -MAP_HX, xMax: MAP_HX, zMin: -MAP_HZ, zMax: MAP_HZ, px: 1 / BASE_PX });
  ui.mapBase = base;

  const campusBuildings = buildings.campus.filter((b) => b.name);
  const catOfBuilding = (b) => (b.cat === 'dorm' ? 'dorm' : b.cat === 'food' ? 'food' : b.special === 'amphitheatre' ? 'venue' : 'academic');

  // --------------------------------------------------------------- helpers
  const fade = el('div');
  fade.style.cssText = 'position:fixed;inset:0;background:#0d1a2c;opacity:0;pointer-events:none;z-index:25;transition:opacity .22s ease';
  document.body.appendChild(fade);

  ui.toast = (msg, ms = 2600) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(ui._toastTimer);
    ui._toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  };

  ui.fadeThen = (fn) => {
    fade.style.opacity = '1';
    setTimeout(() => {
      fn();
      setTimeout(() => (fade.style.opacity = '0'), 60);
    }, 230);
  };

  ui.teleport = (x, z, yaw) => {
    fade.style.opacity = '1';
    setTimeout(() => {
      if (sim.interior && sim.interior.current) sim.interior.exitInstant();
      player.teleport(x, z, yaw);
      player.pitch = 0;
      crowd.update(0, player, camera);
      setTimeout(() => (fade.style.opacity = '0'), 60);
    }, 230);
  };

  const closeMenu = () => {
    if (!ui.menu) return;
    $(`#menu-${ui.menu}`).classList.add('hidden');
    ui.menu = null;
    player.enabled = ui.running;
    if (ui.running) {
      ui.ignoreUnlock = false;
      player.requestLock();
    }
  };

  const openMenu = (name) => {
    if (!ui.running) return;
    if (ui.menu === name) return closeMenu();
    if (ui.menu) $(`#menu-${ui.menu}`).classList.add('hidden');
    ui.ignoreUnlock = true;
    ui.menu = name;
    player.enabled = false;
    player.keys.clear();
    player.releaseLock();
    $(`#menu-${name}`).classList.remove('hidden');
    if (builders[name]) builders[name]();
  };
  ui.openMenu = openMenu;
  ui.closeMenu = closeMenu;

  const sheet = (title, cls = '') => {
    const s = el('div', `sheet ${cls}`);
    const head = el('div', 'sheet-head');
    head.appendChild(el('h2', '', title));
    const close = el('button', 'ghost sheet-close', 'Kapat');
    close.addEventListener('click', closeMenu);
    head.appendChild(close);
    s.appendChild(head);
    return s;
  };
  const overlayClick = (id) => {
    $(id).addEventListener('mousedown', (e) => {
      if (e.target === $(id)) closeMenu();
    });
  };
  ['#menu-places', '#menu-map', '#menu-info', '#menu-settings'].forEach(overlayClick);

  // ---------------------------------------------------------------- places
  const builders = {};
  builders.places = () => {
    const root = $('#menu-places');
    root.textContent = '';
    const s = sheet('Yerler', 'narrow');
    const body = el('div', 'sheet-body');
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = 'Yer ara';
    search.setAttribute('aria-label', 'Yer ara');
    body.appendChild(search);
    const list = el('div');
    body.appendChild(list);
    const render = () => {
      list.textContent = '';
      const q = search.value.trim().toLocaleLowerCase('tr');
      for (const g of groups) {
        const items = places.filter((p) => p.group === g && (!q || p.title.toLocaleLowerCase('tr').includes(q)));
        if (!items.length) continue;
        if (g === 'Kampüs dışı' && !boundary.allowOutside) {
          list.appendChild(el('div', 'group-title', 'Kampüs dışı'));
          list.appendChild(el('p', 'note', 'Kampüs sınırının dışı kapalı. Ayarlar bölümünden "Kampüs dışını gezmeye izin ver" seçeneğini açarsanız burada listelenir.'));
          continue;
        }
        list.appendChild(el('div', 'group-title', g));
        for (const p of items) {
          const row = el('button', 'row');
          row.style.setProperty('--cat', CAT_COLOR[p.cat] || CAT_COLOR.other);
          row.appendChild(el('span', 'row-tab'));
          const name = el('span', 'row-name', p.title);
          name.appendChild(el('span', 'row-sub', p.sub || CAT_LABEL[p.cat]));
          row.appendChild(name);
          row.appendChild(el('span', 'row-dist', `${Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z))} m`));
          row.addEventListener('click', () => {
            closeMenu();
            ui.teleport(p.x, p.z, p.yaw);
          });
          list.appendChild(row);
        }
      }
    };
    search.addEventListener('input', render);
    render();
    s.appendChild(body);
    root.appendChild(s);
    search.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------ info panel
  builders.info = () => {
    const root = $('#menu-info');
    root.textContent = '';
    const s = sheet('Kampüs bilgisi ve veri seti', '');
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    const body = el('div', 'sheet-body');
    const names = ['Kampüs', 'Birimler', 'Laboratuvarlar', 'Ulaşım ve tesisler', 'Veri seti'];
    const panes = [paneCampus, paneUnits, paneLabs, paneFacilities, paneData];
    const tabBtns = names.map((n, i) => {
      const b = el('button', 'tab', n);
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => select(i));
      tabs.appendChild(b);
      return b;
    });
    const select = (i) => {
      tabBtns.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
      body.textContent = '';
      panes[i](body);
      ui._infoTab = i;
    };
    s.appendChild(tabs);
    s.appendChild(body);
    root.appendChild(s);
    select(ui._infoTab || 0);
  };

  function paneCampus(body) {
    const u = data.info.university;
    const st = data.meta.stats;
    body.appendChild(el('p', 'note', u.scopeNote));
    const row = el('div', 'stat-row');
    for (const [v, l] of [[st.campusBuildings, 'kampüs binası'], [Object.keys(data.info.places).length, 'açıklamalı yer'], [data.doors.length, 'kapı'], [Math.round(hf.dem(0, 0) + hf.y0), 'm, kampüs merkez yüksekliği']]) {
      const d = el('div', 'stat');
      d.appendChild(el('b', '', String(v)));
      d.appendChild(el('span', '', l));
      row.appendChild(d);
    }
    body.appendChild(row);
    const cols = el('div', 'info-cols');
    const block = (title, lines) => {
      const b = el('div', 'info-block');
      b.appendChild(el('h3', '', title));
      for (const l of lines) b.appendChild(el('p', '', l));
      cols.appendChild(b);
    };
    block('Adres', [u.address, `İşleten kuruluş: ${u.foundation}`]);
    block('Gezinti', ['Kampüs sınırı çit ve bariyerlerle kapalıdır; dışarı çıkış ayarlardan açılabilir.', 'Binalara kapılardan girilir. İç mekânlar gerçek kat planı değil, simülasyon için üretilmiş genel yerleşimdir.']);
    for (const f of data.info.facilities) block(f.title, [f.text]);
    body.appendChild(cols);
  }

  function paneUnits(body) {
    body.appendChild(el('p', 'note', 'Liste ieu.edu.tr ana sayfasındaki menüden alınmıştır ve tüm üniversiteyi kapsar. Birimlerin hangi binada olduğu doğrulanabilir bir kaynaktan alınamadığı için eşleme yapılmamıştır.'));
    const units = data.info.academicUnits;
    const cols = el('div', 'info-cols');
    const isGrad = (k) => /Alanı$/.test(k);
    const groupsOrdered = Object.keys(units).filter((k) => !isGrad(k));
    const grads = Object.keys(units).filter(isGrad);
    const mk = (k, list) => {
      const b = el('div', 'info-block');
      b.appendChild(el('h3', '', k));
      const ul = el('ul');
      for (const p of list) {
        const name = p.name.trim();
        if (name === k || name.replace(/ \(Türkçe\)/, '') === k) continue;
        ul.appendChild(el('li', '', name));
      }
      if (ul.children.length) b.appendChild(ul);
      cols.appendChild(b);
    };
    groupsOrdered.forEach((k) => mk(k, units[k]));
    body.appendChild(cols);
    body.appendChild(el('h3', '', 'Lisansüstü alanlar'));
    const cols2 = el('div', 'info-cols');
    grads.forEach((k) => {
      const b = el('div', 'info-block');
      b.appendChild(el('h3', '', k.replace(/ Alanı$/, '')));
      const ul = el('ul');
      units[k].slice(1).forEach((p) => ul.appendChild(el('li', '', p.name.trim())));
      b.appendChild(ul);
      cols2.appendChild(b);
    });
    body.appendChild(cols2);
  }

  function paneLabs(body) {
    body.appendChild(el('p', 'note', data.info.labs.note));
    const ul = el('ul');
    ul.style.columns = '2 260px';
    for (const l of data.info.labs.items) ul.appendChild(el('li', '', l));
    body.appendChild(ul);
    const p = el('p', '', `Kaynak: ${data.info.labs.source}`);
    p.style.fontSize = '13px';
    body.appendChild(p);
  }

  function paneFacilities(body) {
    const cols = el('div', 'info-cols');
    for (const t of data.info.transport) {
      const b = el('div', 'info-block');
      b.appendChild(el('h3', '', t.title));
      b.appendChild(el('p', '', `${t.text} (${SRC_LABEL[t.src] || t.src})`));
      cols.appendChild(b);
    }
    body.appendChild(cols);
  }

  function paneData(body) {
    const st = data.meta.stats;
    const row = el('div', 'stat-row');
    for (const [v, l] of [[st.buildings + st.farBuildings, 'bina şekli'], [st.roads, 'yol ve patika'], [st.areas, 'arazi parçası'], [st.pois, 'nokta'], [data.terrain.rows * data.terrain.cols, 'yükseklik noktası']]) {
      const d = el('div', 'stat');
      d.appendChild(el('b', '', v.toLocaleString('tr-TR')));
      d.appendChild(el('span', '', l));
      row.appendChild(d);
    }
    body.appendChild(row);
    const cols = el('div', 'info-cols');
    const src = el('div', 'info-block');
    src.appendChild(el('h3', '', 'Kaynaklar'));
    const ul = el('ul');
    for (const s of data.meta.sources) ul.appendChild(el('li', '', `${s.label}, ${s.retrieved}`));
    src.appendChild(ul);
    cols.appendChild(src);
    const notes = el('div', 'info-block');
    notes.appendChild(el('h3', '', 'Sınırlar ve varsayımlar'));
    const ul2 = el('ul');
    for (const n of data.meta.notes) ul2.appendChild(el('li', '', n));
    notes.appendChild(ul2);
    cols.appendChild(notes);
    body.appendChild(cols);
    if (sim.eggs) {
      const list = sim.eggs.list;
      const blk = el('div', 'info-block');
      blk.appendChild(el('h3', '', `Sürprizler (${list.filter((e) => e.found).length}/${list.length} bulundu)`));
      const ul3 = el('ul');
      for (const e of list) ul3.appendChild(el('li', '', e.found ? `${e.title} (${e.kind})` : '???'));
      blk.appendChild(ul3);
      blk.appendChild(el('p', 'note', 'Gerçek: bilgi halka açık bir kaynağa dayanıyor, nesne tasarım tercihi. Kurgu: tamamen şaka.'));
      body.appendChild(blk);
    }
    const a = el('a', '', 'campus.json dosyasını aç');
    a.href = 'data/campus.json';
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.color = '#c76a0f';
    body.appendChild(a);
  }

  // ------------------------------------------------------------ big map
  const mapState = { cx: 0, cz: 0, zoom: 2.4, drag: null, moved: false, hover: null };
  builders.map = () => {
    const root = $('#menu-map');
    root.textContent = '';
    const s = sheet('Kampüs haritası', 'wide');
    const body = el('div', 'sheet-body');
    const wrap = el('div', 'map-wrap');
    const cv = el('canvas');
    cv.id = 'map-canvas';
    wrap.appendChild(cv);
    body.appendChild(wrap);
    const legend = el('div', 'map-legend');
    for (const [k, l] of [['academic', 'Akademik bina'], ['dorm', 'Yurt'], ['food', 'Yeme içme'], ['venue', 'Etkinlik'], ['library', 'Kütüphane'], ['green', 'Yeşil alan']]) {
      const i = el('span');
      const sw = el('i');
      sw.style.background = CAT_COLOR[k];
      i.appendChild(sw);
      i.appendChild(document.createTextNode(l));
      legend.appendChild(i);
    }
    legend.appendChild(el('span', '', 'Eş yükselti çizgileri 2 m aralıklı, kalın çizgiler 10 m. Haritaya tıklayın, oraya ışınlanın. Sürükleyin ve tekerlekle yakınlaştırın.'));
    body.appendChild(legend);
    s.appendChild(body);
    root.appendChild(s);
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    mapState.cx = player.pos.x;
    mapState.cz = player.pos.z;
    mapState.zoom = Math.max(1.6, (Math.min(rect.width, rect.height) * dpr) / 300);
    mapState.dpr = dpr;
    bindMap(cv);
    drawBigMap(cv);
  };

  const mapToWorld = (cv, ev) => {
    const r = cv.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * cv.width;
    const sy = ((ev.clientY - r.top) / r.height) * cv.height;
    return { sx, sy, x: mapState.cx + (sx - cv.width / 2) / mapState.zoom, z: mapState.cz + (sy - cv.height / 2) / mapState.zoom };
  };

  function bindMap(cv) {
    cv.onmousedown = (e) => {
      mapState.drag = { x: e.clientX, y: e.clientY, cx: mapState.cx, cz: mapState.cz };
      mapState.moved = false;
    };
    window.onmouseup = () => (mapState.drag = null);
    cv.onmousemove = (e) => {
      const w = mapToWorld(cv, e);
      if (mapState.drag) {
        const dx = (e.clientX - mapState.drag.x) * (cv.width / cv.getBoundingClientRect().width);
        const dy = (e.clientY - mapState.drag.y) * (cv.height / cv.getBoundingClientRect().height);
        if (Math.abs(dx) + Math.abs(dy) > 4) mapState.moved = true;
        mapState.cx = mapState.drag.cx - dx / mapState.zoom;
        mapState.cz = mapState.drag.cz - dy / mapState.zoom;
      }
      mapState.hover = campusBuildings.find((b) => pointInRing(w.x, w.z, b.ring)) || null;
      drawBigMap(cv);
    };
    cv.onwheel = (e) => {
      e.preventDefault();
      const before = mapToWorld(cv, e);
      mapState.zoom = clamp(mapState.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1.2, 14);
      const after = mapToWorld(cv, e);
      mapState.cx += before.x - after.x;
      mapState.cz += before.z - after.z;
      drawBigMap(cv);
    };
    cv.onclick = (e) => {
      if (mapState.moved) return;
      const w = mapToWorld(cv, e);
      teleportFromMap(w.x, w.z);
    };
  }

  function teleportFromMap(x, z) {
    if (!boundary.allowOutside && !pointInRing(x, z, data.campusRing)) {
      ui.toast('Kampüs dışına ışınlanılamaz. Ayarlardan izin verebilirsiniz.');
      return;
    }
    const n = sim.navgrid.nearest(x, z);
    let tx = x;
    let tz = z;
    if (n >= 0) {
      const [nx, nz] = sim.navgrid.pos(n);
      if (Math.hypot(nx - x, nz - z) < 40) {
        tx = nx;
        tz = nz;
      }
    }
    closeMenu();
    ui.teleport(tx, tz, player.yaw);
  }

  function drawBigMap(cv) {
    const g = cv.getContext('2d');
    const z = mapState.zoom;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#e4e8e0';
    g.fillRect(0, 0, cv.width, cv.height);
    g.setTransform(z, 0, 0, z, cv.width / 2 - mapState.cx * z, cv.height / 2 - mapState.cz * z);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(base, -MAP_HX, -MAP_HZ, 2 * MAP_HX, 2 * MAP_HZ);
    const px = 1 / z;
    // Campus building labels.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${px * 15}px "Barlow Semi Condensed", "Barlow", sans-serif`;
    for (const b of campusBuildings) {
      const label = shortName(b);
      if (!label) continue;
      g.lineWidth = px * 4;
      g.strokeStyle = 'rgba(20,36,59,0.9)';
      g.strokeText(label, b.c[0], b.c[1]);
      g.fillStyle = '#ffffff';
      g.fillText(label, b.c[0], b.c[1]);
    }
    // Places as pins.
    for (const p of places) {
      if (p.outside && !boundary.allowOutside) continue;
      g.beginPath();
      g.arc(p.x, p.z, px * 5.2, 0, Math.PI * 2);
      g.fillStyle = CAT_COLOR[p.cat] || CAT_COLOR.other;
      g.fill();
      g.lineWidth = px * 1.8;
      g.strokeStyle = '#fff';
      g.stroke();
    }
    // Gates.
    for (const gt of boundary.gates) {
      g.save();
      g.translate(gt.x, gt.z);
      g.rotate(Math.atan2(gt.az, gt.ax));
      g.fillStyle = '#f28c28';
      g.fillRect(-gt.w / 2, -px * 3, gt.w, px * 6);
      g.restore();
    }
    // People.
    g.fillStyle = 'rgba(20,36,59,0.75)';
    for (let i = 0; i < crowd.active; i++) {
      const n = crowd.npcs[i];
      if (!n.visible) continue;
      g.beginPath();
      g.arc(n.x, n.z, px * 2, 0, Math.PI * 2);
      g.fill();
    }
    drawPlayerArrow(g, player.pos.x, player.pos.z, player.yaw, px * 15, px);
    if (mapState.hover) {
      const b = mapState.hover;
      const meta = data.info.places[String(b.id)];
      g.font = `700 ${px * 17}px "Barlow Semi Condensed", "Barlow", sans-serif`;
      const txt = (meta && meta.title) || b.name;
      const w = g.measureText(txt).width;
      g.fillStyle = '#14243b';
      g.fillRect(b.c[0] - w / 2 - px * 8, b.c[1] - px * 40, w + px * 16, px * 26);
      g.fillStyle = '#fff';
      g.fillText(txt, b.c[0], b.c[1] - px * 27);
    }
    // Compass and scale (screen space).
    g.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = mapState.dpr || 1;
    g.fillStyle = '#14243b';
    g.font = `700 ${18 * dpr}px "Barlow Semi Condensed", sans-serif`;
    g.textAlign = 'center';
    g.fillText('K', cv.width - 30 * dpr, 22 * dpr);
    g.beginPath();
    g.moveTo(cv.width - 30 * dpr, 30 * dpr);
    g.lineTo(cv.width - 24 * dpr, 52 * dpr);
    g.lineTo(cv.width - 36 * dpr, 52 * dpr);
    g.closePath();
    g.fill();
    const nice = [5, 10, 20, 50, 100, 200].find((m) => m * z > 90 * dpr) || 200;
    g.fillRect(16 * dpr, cv.height - 22 * dpr, nice * z, 3 * dpr);
    g.font = `600 ${13 * dpr}px "Barlow", sans-serif`;
    g.textAlign = 'left';
    g.fillText(`${nice} m`, 16 * dpr, cv.height - 28 * dpr);
  }

  function drawPlayerArrow(g, x, z, yaw, size, px) {
    g.save();
    g.translate(x, z);
    g.rotate(-yaw);
    g.beginPath();
    g.moveTo(0, -size);
    g.lineTo(size * 0.7, size * 0.75);
    g.lineTo(0, size * 0.4);
    g.lineTo(-size * 0.7, size * 0.75);
    g.closePath();
    g.fillStyle = '#f28c28';
    g.fill();
    g.lineWidth = px * 2;
    g.strokeStyle = '#14243b';
    g.stroke();
    g.restore();
  }

  // -------------------------------------------------------------- settings
  builders.settings = () => {
    const root = $('#menu-settings');
    root.textContent = '';
    const s = sheet('Ayarlar', 'narrow');
    const body = el('div', 'sheet-body');
    const field = (label, input, valueText) => {
      const f = el('div', 'field');
      const l = el('label');
      l.textContent = label;
      if (valueText !== undefined) {
        const v = el('span', 'value', valueText);
        l.appendChild(v);
        f._value = v;
      }
      f.appendChild(l);
      f.appendChild(input);
      return f;
    };
    const range = (min, max, step, val, oninput, fmt) => {
      const i = el('input');
      i.type = 'range';
      i.min = min;
      i.max = max;
      i.step = step;
      i.value = val;
      const f = { i };
      i.addEventListener('input', () => {
        oninput(parseFloat(i.value));
        if (f.field && f.field._value) f.field._value.textContent = fmt(parseFloat(i.value));
      });
      return f;
    };
    const check = (label, checked, onchange) => {
      const w = el('label', 'check');
      const c = el('input');
      c.type = 'checkbox';
      c.checked = checked;
      c.addEventListener('change', () => onchange(c.checked));
      w.appendChild(c);
      w.appendChild(document.createTextNode(label));
      return w;
    };
    const timeR = range(0, 24, 0.05, sky.hours, (v) => sim.clock.setHours(v), fmtClock);
    timeR.field = field('Saat', timeR.i, fmtClock(sky.hours));
    body.appendChild(timeR.field);
    // Date and kind of day (real academic calendar): drives who is on campus and what is open.
    const dateIn = el('input', 'search');
    dateIn.type = 'date';
    dateIn.value = sim.clock.key;
    const dayNote = el('p', 'note', '');
    const showDay = () => {
      const i = sim.clock.info;
      dayNote.textContent = `${fmtDate(sim.clock.date)}: ${i.text}${i.label ? ` (${i.label.toLowerCase()})` : ''}.`;
    };
    showDay();
    const setDate = (date) => {
      sim.clock.setDate(date);
      dateIn.value = sim.clock.key;
      showDay();
    };
    dateIn.addEventListener('change', () => dateIn.value && setDate(parseDate(dateIn.value)));
    body.appendChild(field('Tarih', dateIn));
    const cal = sim.data.real && sim.data.real.calendar;
    const now = new Date();
    const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    const scen = [['Bugün (gerçek tarih)', today]];
    if (cal) {
      const sunday = (() => {
        let d = today;
        while (new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() !== 0) d = addDays(d, 1);
        return d;
      })();
      const cumhuriyet = cal.holidays.find((h) => /Cumhuriyet/.test(h.name));
      scen.push(['Ara sınav haftası', parseDate(cal.exams[0].from)], ['Final haftası', parseDate(cal.exams[1].from)]);
      if (cumhuriyet) scen.push(['29 Ekim Cumhuriyet Bayramı', parseDate(cumhuriyet.to)]);
      scen.push(['Hafta sonu', sunday]);
      if (cal.makeups[0]) scen.push(['Telafi cumartesisi', parseDate(cal.makeups[0].date)]);
      scen.push(['Dönem arası', addDays(parseDate(cal.terms[0].to), 14)]);
    }
    const scenSel = el('select', 'search');
    scenSel.appendChild(Object.assign(el('option', '', 'Gün seç...'), { value: '' }));
    scen.forEach(([label], i) => scenSel.appendChild(Object.assign(el('option', '', label), { value: String(i) })));
    scenSel.addEventListener('change', () => {
      if (scenSel.value !== '') setDate(scen[Number(scenSel.value)][1]);
      scenSel.value = '';
    });
    body.appendChild(field('Hızlı gün', scenSel));
    body.appendChild(dayNote);
    const speed = el('select', 'search');
    for (const [v, l] of [[0, 'Saat sabit'], [-1, 'Bilgisayar saati (gerçek tarih ve saat)'], [1, 'Gerçek hız'], [20, '20 kat hızlı (varsayılan)'], [120, '120 kat hızlı']]) {
      const o = el('option', '', l);
      o.value = v;
      if (v === ui.timeScale) o.selected = true;
      speed.appendChild(o);
    }
    speed.addEventListener('change', () => {
      let v = parseFloat(speed.value);
      if (v < 0) {
        // Follow the computer's clock: today's real date and time, at real speed.
        const n = new Date();
        sim.clock.setDate({ y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() });
        sim.clock.setHours(n.getHours() + n.getMinutes() / 60 + n.getSeconds() / 3600);
        dateIn.value = sim.clock.key;
        showDay();
        v = 1;
      }
      ui.timeScale = v;
      sim.clock.timeScale = v;
    });
    body.appendChild(field('Zaman akışı', speed));
    const autoCrowd = check('Kalabalık takvime ve saate göre değişsin', crowd.auto, (v) => {
      crowd.auto = v;
    });
    const npc = range(0, 200, 5, crowd.aliveCount(), (v) => {
      crowd.auto = false;
      autoCrowd.querySelector('input').checked = false;
      crowd.setCount(v);
    }, (v) => `${v} kişi`);
    npc.field = field('Kalabalık', npc.i, `${crowd.aliveCount()} kişi`);
    body.appendChild(npc.field);
    body.appendChild(autoCrowd);
    body.appendChild(check('Çevre trafiği (kampüs dışındaki caddelerde)', sim.props.traffic.enabled ?? false, (v) => sim.props.traffic.setEnabled(v)));
    body.appendChild(check('Kampüs dışını gezmeye izin ver', boundary.allowOutside, (v) => {
      boundary.setAllowOutside(v);
      ui.toast(v ? 'Kampüs sınırı açıldı. Kapı bariyerleri kalkıyor.' : 'Kampüs sınırı kapalı.');
    }));
    body.appendChild(check('Uçuş modu (V)', player.fly, (v) => (player.fly = v)));
    body.appendChild(check('Bina etiketleri', ui.labels, (v) => (ui.labels = v)));
    body.appendChild(check('Mini harita', ui.minimap, (v) => {
      ui.minimap = v;
      $('#minimap-wrap').style.display = v ? '' : 'none';
    }));
    body.appendChild(check('Gölgeler', sim.renderer.shadowMap.enabled, (v) => {
      sim.renderer.shadowMap.enabled = v;
      sky.sun.castShadow = v;
      sim.scene.traverse((o) => {
        if (o.material) o.material.needsUpdate = true;
      });
    }));
    const walk = range(0.5, 2.5, 0.1, player.speedScale, (v) => (player.speedScale = v), (v) => `${v.toFixed(1)}x`);
    walk.field = field('Yürüme hızı', walk.i, `${player.speedScale.toFixed(1)}x`);
    body.appendChild(walk.field);
    const sens = range(0.5, 2.5, 0.1, player.sensitivity / 0.0022, (v) => (player.sensitivity = 0.0022 * v), (v) => `${v.toFixed(1)}x`);
    sens.field = field('Fare hassasiyeti', sens.i, `${(player.sensitivity / 0.0022).toFixed(1)}x`);
    body.appendChild(sens.field);
    const fov = range(55, 100, 1, camera.fov, (v) => {
      camera.fov = v;
      camera.updateProjectionMatrix();
    }, (v) => `${v}°`);
    fov.field = field('Görüş açısı', fov.i, `${Math.round(camera.fov)}°`);
    body.appendChild(fov.field);
    const btns = el('div', 'btn-row');
    const resume = el('button', 'primary', 'Devam et');
    resume.addEventListener('click', closeMenu);
    btns.appendChild(resume);
    const home = el('button', 'ghost', 'Başlangıç noktasına dön');
    home.addEventListener('click', () => {
      closeMenu();
      ui.teleport(sim.spawn.x, sim.spawn.z, sim.spawn.yaw);
    });
    btns.appendChild(home);
    body.appendChild(btns);
    s.appendChild(body);
    root.appendChild(s);
  };

  // ------------------------------------------------------------ start screen
  const contours$ = $('#contours');
  const paintStart = () => drawContourArt(contours$, data, hf);
  ui.paintStart = paintStart;
  window.addEventListener('resize', () => {
    if (!$('#start').classList.contains('hidden')) paintStart();
  });

  ui.start = () => {
    $('#start').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    ui.running = true;
    player.enabled = true;
    player.requestLock();
    ui.toast('Kampüse hoş geldiniz. Binalara kapılardan yürüyerek girin. Harita M, yerler T.', 4600);
  };

  // -------------------------------------------------------------- keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
      if (e.code === 'Escape') closeMenu();
      return;
    }
    if (!ui.running) return;
    switch (e.code) {
      case 'KeyT': openMenu('places'); break;
      case 'KeyM': openMenu('map'); break;
      case 'KeyI': openMenu('info'); break;
      case 'Escape':
        if (ui.menu) closeMenu();
        else openMenu('settings');
        break;
      case 'KeyV':
        if (!ui.menu) {
          player.fly = !player.fly;
          if (!player.fly) player.snapToGround();
          ui.toast(player.fly ? 'Uçuş modu açık. Boşluk yukarı, C aşağı.' : 'Uçuş modu kapalı.');
        }
        break;
      case 'KeyH':
        ui.hud = !ui.hud;
        $('#hud').style.visibility = ui.hud ? 'visible' : 'hidden';
        break;
      case 'BracketLeft': ui.mmZoom = clamp(ui.mmZoom * 1.2, 70, 300); break;
      case 'BracketRight': ui.mmZoom = clamp(ui.mmZoom / 1.2, 70, 300); break;
      case 'KeyE':
      case 'KeyQ':
        if (!ui.menu) interact(e.code);
        break;
      default: break;
    }
  });

  player.onLockChange = (locked) => {
    if (!locked && ui.running && !ui.menu && !ui.ignoreUnlock) openMenu('settings');
    if (locked) ui.ignoreUnlock = false;
  };
  player.onEdge = () => {
    ui.toast(boundary.allowOutside ? 'Kampüs sınırına ulaştınız.' : 'Kampüs sınırı. Dışarı çıkış kapalı (Ayarlar bölümünden açılabilir).');
  };
  $('#view').addEventListener('click', () => {
    if (ui.running && !ui.menu && !player.locked) player.requestLock();
  });

  // ------------------------------------------------------------- interaction
  let promptState = null;
  const promptSignature = (p) => (p.keys ? p.keys.map((k) => k.join(':')).join('|') : `${p.key || 'E'}:${p.text}`);
  const setPrompt = (p) => {
    const box = $('#prompt');
    if (!p) {
      if (promptState) box.classList.add('hidden');
      promptState = null;
      $('#crosshair').classList.remove('active');
      return;
    }
    const sig = promptSignature(p);
    if (!promptState || promptState.sig !== sig) {
      box.textContent = '';
      const pairs = p.keys || [[p.key || 'E', p.text]];
      pairs.forEach(([k, label], i) => {
        if (i) box.appendChild(document.createTextNode('   '));
        box.appendChild(el('kbd', '', k));
        box.appendChild(document.createTextNode(` ${label}`));
      });
      box.classList.remove('hidden');
    }
    promptState = { sig, prompt: p };
    $('#crosshair').classList.add('active');
  };

  function findPrompt() {
    if (sim.interior) {
      const ip = sim.interior.prompt(player);
      if (ip) return ip;
    }
    // Doors from outside.
    if (!(sim.interior && sim.interior.current)) {
      let best = null;
      let bd = 2.6;
      for (const d of data.doors) {
        const dx = d.x + d.nx * 0.8 - player.pos.x;
        const dz = d.z + d.nz * 0.8 - player.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < bd) {
          bd = dist;
          best = d;
        }
      }
      if (best && sim.interior) {
        const b = buildings.all.find((q) => q.id === best.b);
        return { text: `İçeri gir: ${(b && b.name) || 'bina'}`, action: () => sim.interior.enter(best) };
      }
    }
    const egg = sim.eggs && sim.eggs.prompt(player, camera);
    if (egg) return egg;
    const npc = crowd.nearest(player, 2.4);
    if (npc) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const dx = npc.x - player.pos.x;
      const dz = npc.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx * fwd.x + dz * fwd.z) / d > 0.6) return { text: 'Selam ver', action: () => crowd.greet(npc, player) };
    }
    return null;
  }

  function interact(code = 'KeyE') {
    const p = findPrompt();
    if (!p) return;
    if (p.actions && p.actions[code]) p.actions[code]();
    else if (code === 'KeyE' && p.action) p.action();
  }

  // ------------------------------------------------------------------ labels
  const labelEls = new Map();
  const labelHost = $('#labels');
  const v3 = new THREE.Vector3();
  const labelDir = new THREE.Vector3();
  function updateLabels() {
    const show = ui.labels && !(sim.interior && sim.interior.current);
    for (const b of campusBuildings) {
      let e = labelEls.get(b.id);
      const meta = data.info.places[String(b.id)];
      if (!e) {
        e = el('div', 'label', (meta && meta.title) || b.name);
        e.style.setProperty('--cat', CAT_COLOR[catOfBuilding(b)]);
        labelHost.appendChild(e);
        labelEls.set(b.id, e);
      }
      if (!show) {
        e.style.display = 'none';
        continue;
      }
      v3.set(b.c[0], b.yTop + 1.5, b.c[1]);
      const dist = Math.hypot(v3.x - player.pos.x, v3.z - player.pos.z);
      v3.project(camera);
      const visible = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && dist < 130;
      if (!visible) {
        e.style.display = 'none';
        continue;
      }
      // Hide labels of buildings hidden behind another building (re-tested every few frames).
      e._n = (e._n || 0) + 1;
      if (e._n % 4 === 1) {
        labelDir.set(b.c[0] - camera.position.x, b.yTop + 1.5 - camera.position.y, b.c[1] - camera.position.z);
        const d3 = labelDir.length() || 1;
        labelDir.multiplyScalar(1 / d3);
        const hit = buildings.pick(camera.position, labelDir, Math.min(d3, 130));
        e._occ = !!(hit && hit.building !== b);
      }
      if (e._occ) {
        e.style.display = 'none';
        continue;
      }
      e.style.display = '';
      e.style.left = `${(v3.x * 0.5 + 0.5) * window.innerWidth}px`;
      e.style.top = `${(-v3.y * 0.5 + 0.5) * window.innerHeight}px`;
      e.style.opacity = String(clamp(1.3 - dist / 130, 0.35, 1));
    }
  }

  // -------------------------------------------------------------------- card
  const card = $('#card');
  let cardKey = null;
  function showCard(key, model) {
    if (!model) {
      if (cardKey) card.classList.add('hidden');
      cardKey = null;
      return;
    }
    if (cardKey !== key) {
      card.textContent = '';
      card.style.setProperty('--cat', CAT_COLOR[model.cat] || CAT_COLOR.other);
      card.appendChild(el('h3', 'card-title', model.title));
      card.appendChild(el('p', 'card-sub', model.sub));
      if (model.blurb) card.appendChild(el('p', 'card-blurb', model.blurb));
      if (model.facts && model.facts.length) {
        const dl = el('dl', 'facts');
        for (const f of model.facts) {
          const row = el('div');
          row.appendChild(el('dt', '', f.k));
          const dd = el('dd', '', f.v);
          if (f.src) dd.appendChild(el('span', f.src === 'tahmin' || f.src === 'foto' ? 'src est' : 'src', SRC_LABEL[f.src] || f.src));
          row.appendChild(dd);
          dl.appendChild(row);
        }
        card.appendChild(dl);
      }
      if (model.foot) card.appendChild(el('p', 'card-foot', model.foot));
      card.classList.remove('hidden');
      cardKey = key;
    }
  }

  const fwdV = new THREE.Vector3();
  ui.showEgg = (egg, first, n, total) => {
    ui.eggUntil = performance.now() + 14000;
    cardKey = null;
    showCard(`egg:${egg.id}`, {
      title: egg.title,
      sub: egg.kind === 'real' ? 'Gerçek bilgi, sürpriz nesne' : 'Kurgu sürpriz',
      cat: egg.kind === 'real' ? 'venue' : 'other',
      blurb: egg.text,
      facts: [{ k: 'Kaynak', v: egg.src }],
      foot: first ? `Yeni sürpriz bulundu (${n}/${total}).` : '',
    });
  };

  function updateCard() {
    if (ui.eggUntil && performance.now() < ui.eggUntil) return;
    if (ui.menu || (sim.interior && sim.interior.current)) return showCard(null, null);
    camera.getWorldDirection(fwdV);
    const hit = buildings.pick(camera.position, fwdV, 75);
    if (hit) {
      const b = hit.building;
      const meta = data.info.places[String(b.id)];
      const facts = [];
      if (meta) facts.push(...meta.facts);
      const heightSrc = b.hsrc === 'osm' ? 'osm' : b.hsrc === 'foto' ? 'foto' : 'tahmin';
      facts.push({ k: 'Yükseklik', v: `${b.h.toFixed(1)} m, ${b.levels} kat`, src: heightSrc });
      facts.push({ k: 'Taban alanı', v: `${b.area.toLocaleString('tr-TR')} m²`, src: 'osm' });
      // Real opening hours where the campus publishes them (only Starbucks matches an OSM building).
      let openKey = '';
      const hrs = sim.data.real && sim.data.real.hours[b.name];
      if (hrs && sim.schedule) {
        const o = sim.schedule.openState(b.name, sim.clock.info, sim.clock.hours);
        const fm = (m) => (m ? `${String(Math.floor(m[0] / 60)).padStart(2, '0')}:${String(m[0] % 60).padStart(2, '0')}-${String(Math.floor(m[1] / 60)).padStart(2, '0')}:${String(m[1] % 60).padStart(2, '0')}` : 'kapalı');
        openKey = o && o.open ? ':a' : ':k';
        facts.unshift({ k: 'Şu an', v: o && o.open ? `Açık (${o.to}'e kadar)` : 'Kapalı', src: 'tim' }, { k: 'Çalışma saatleri', v: `Hafta içi ${fm(hrs.weekday)}, cumartesi ${fm(hrs.saturday)}, pazar ${fm(hrs.sunday)}`, src: 'tim' });
      }
      return showCard(`b${b.id}${openKey}`, {
        title: (meta && meta.title) || b.name,
        sub: CAT_LABEL[catOfBuilding(b)],
        cat: catOfBuilding(b),
        blurb: meta ? meta.blurb : '',
        facts,
        foot: hit.dist < 40 ? 'Kapıya yaklaşıp E tuşuyla içeri girebilirsiniz.' : '',
      });
    }
    // Other named POIs straight ahead.
    let best = null;
    let bd = 1e9;
    for (const p of data.pois) {
      if (!p.name || !data.info.places[String(p.id)]) continue;
      const dx = p.x - player.pos.x;
      const dz = p.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 40 || d < 1) continue;
      if ((dx * fwdV.x + dz * fwdV.z) / d < 0.93) continue;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      const meta = data.info.places[String(best.id)];
      return showCard(`p${best.id}`, { title: meta.title, sub: CAT_LABEL[best.cat === 'food' ? 'food' : best.cat === 'library' ? 'library' : 'transport'] || 'Nokta', cat: best.cat === 'food' ? 'food' : best.cat === 'library' ? 'library' : 'transport', blurb: meta.blurb, facts: meta.facts });
    }
    return showCard(null, null);
  }

  // ------------------------------------------------------------- place plate
  const placeName = $('#place-name');
  const placeSub = $('#place-sub');
  const placeTab = $('#place-tab');
  const areasNamed = data.areas.filter((a) => a.name && /^IEU /.test(a.name));
  let lastPlace = '';
  function updatePlace() {
    let title = 'Kampüs alanı';
    let sub = 'Sakarya Caddesi No:156, Balçova';
    let cat = 'academic';
    const x = player.pos.x;
    const z = player.pos.z;
    const inCampus = pointInRing(x, z, data.campusRing);
    if (sim.interior && sim.interior.current) {
      const p = sim.interior.place();
      title = p.title;
      sub = p.sub;
      cat = p.cat || 'academic';
    } else {
      const b = buildings.campus.find((q) => {
        const bb = q.bb || (q.bb = null);
        return bb && x >= bb.minX && x <= bb.maxX && z >= bb.minZ && z <= bb.maxZ && pointInRing(x, z, q.ring);
      });
      let near = null;
      let nd = 9;
      for (const q of buildings.campus) {
        if (!q.name) continue;
        const bb = q.bb || (q.bb = ringBoundsOf(q.ring));
        const dx = Math.max(bb.minX - x, 0, x - bb.maxX);
        const dz = Math.max(bb.minZ - z, 0, z - bb.maxZ);
        const d = Math.hypot(dx, dz);
        if (d < nd) {
          nd = d;
          near = q;
        }
      }
      if (b && b.name) {
        title = (data.info.places[String(b.id)] || {}).title || b.name;
        sub = 'Bina';
        cat = catOfBuilding(b);
      } else {
        const area = areasNamed.find((a) => pointInRing(x, z, a.r));
        if (area) {
          title = (data.info.places[String(area.id)] || {}).title || area.name;
          sub = 'Yeşil alan';
          cat = 'green';
        } else if (near) {
          title = (data.info.places[String(near.id)] || {}).title || near.name;
          sub = 'Yakınında';
          cat = catOfBuilding(near);
        } else if (!inCampus) {
          title = 'Kampüs dışı';
          sub = 'Balçova';
          cat = 'gate';
        }
      }
    }
    const key = title + sub + cat;
    if (key === lastPlace) return;
    lastPlace = key;
    placeName.textContent = title;
    placeSub.textContent = sub;
    placeTab.style.setProperty('--cat', CAT_COLOR[cat] || CAT_COLOR.other);
    $('#place').style.setProperty('--cat', CAT_COLOR[cat] || CAT_COLOR.other);
  }
  function ringBoundsOf(ring) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]);
      maxX = Math.max(maxX, ring[i]);
      minZ = Math.min(minZ, ring[i + 1]);
      maxZ = Math.max(maxZ, ring[i + 1]);
    }
    return { minX, maxX, minZ, maxZ };
  }
  for (const b of buildings.campus) b.bb = ringBoundsOf(b.ring);

  // ----------------------------------------------------------------- compass
  const compass = $('#compass-canvas');
  const cctx = compass.getContext('2d');
  const CARD = [['K', 0], ['KD', 45], ['D', 90], ['GD', 135], ['G', 180], ['GB', 225], ['B', 270], ['KB', 315]];
  function drawCompass() {
    const w = compass.width;
    const h = compass.height;
    cctx.clearRect(0, 0, w, h);
    const heading = ((((-player.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const span = 110;
    const pxPerDeg = w / span;
    cctx.fillStyle = 'rgba(243,245,242,0.94)';
    cctx.beginPath();
    cctx.roundRect(0, 0, w, h, 10);
    cctx.fill();
    cctx.save();
    cctx.beginPath();
    cctx.roundRect(0, 0, w, h, 10);
    cctx.clip();
    for (let d = Math.floor(heading - span / 2 - 5); d <= heading + span / 2 + 5; d++) {
      if (d % 5 !== 0) continue;
      const deg = ((d % 360) + 360) % 360;
      const x = w / 2 + (d - heading) * pxPerDeg;
      const major = deg % 15 === 0;
      cctx.fillStyle = '#14243b';
      cctx.fillRect(x - 1, h - (major ? 26 : 14), 2, major ? 26 : 14);
      const c = CARD.find((k) => k[1] === deg);
      if (c) {
        cctx.font = `700 ${c[0].length > 1 ? 24 : 34}px "Barlow Semi Condensed", sans-serif`;
        cctx.textAlign = 'center';
        cctx.textBaseline = 'middle';
        cctx.fillStyle = c[0] === 'K' ? '#c76a0f' : '#14243b';
        cctx.fillText(c[0], x, 22);
      }
    }
    cctx.restore();
    cctx.fillStyle = '#f28c28';
    cctx.beginPath();
    cctx.moveTo(w / 2, h - 2);
    cctx.lineTo(w / 2 - 10, h + 8);
    cctx.lineTo(w / 2 + 10, h + 8);
    cctx.closePath();
    cctx.fill();
  }

  // ----------------------------------------------------------------- minimap
  const mm = $('#minimap');
  const mctx = mm.getContext('2d');
  $('#minimap-n').style.display = 'none';
  function drawMinimap() {
    const W = mm.width;
    const s = W / ui.mmZoom;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#e4e8e0';
    mctx.fillRect(0, 0, W, W);
    mctx.save();
    mctx.translate(W / 2, W / 2);
    mctx.rotate(player.yaw);
    mctx.scale(s, s);
    mctx.translate(-player.pos.x, -player.pos.z);
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(base, -MAP_HX, -MAP_HZ, 2 * MAP_HX, 2 * MAP_HZ);
    const px = 1 / s;
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.font = `700 ${px * 11}px "Barlow Semi Condensed", sans-serif`;
    for (const b of campusBuildings) {
      const label = shortName(b);
      if (!label) continue;
      // Keep labels upright by counter-rotating.
      mctx.save();
      mctx.translate(b.c[0], b.c[1]);
      mctx.rotate(-player.yaw);
      mctx.lineWidth = px * 3;
      mctx.strokeStyle = 'rgba(20,36,59,0.9)';
      mctx.strokeText(label, 0, 0);
      mctx.fillStyle = '#fff';
      mctx.fillText(label, 0, 0);
      mctx.restore();
    }
    for (const gt of boundary.gates) {
      mctx.save();
      mctx.translate(gt.x, gt.z);
      mctx.rotate(Math.atan2(gt.az, gt.ax));
      mctx.fillStyle = '#f28c28';
      mctx.fillRect(-gt.w / 2, -px * 2.5, gt.w, px * 5);
      mctx.restore();
    }
    mctx.fillStyle = 'rgba(20,36,59,0.8)';
    for (let i = 0; i < crowd.active; i++) {
      const n = crowd.npcs[i];
      if (!n.visible) continue;
      if (Math.abs(n.x - player.pos.x) > ui.mmZoom || Math.abs(n.z - player.pos.z) > ui.mmZoom) continue;
      mctx.beginPath();
      mctx.arc(n.x, n.z, px * 2.1, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.restore();
    // Player and north marker.
    mctx.save();
    mctx.translate(W / 2, W / 2);
    mctx.beginPath();
    mctx.moveTo(0, -15);
    mctx.lineTo(10, 12);
    mctx.lineTo(0, 6);
    mctx.lineTo(-10, 12);
    mctx.closePath();
    mctx.fillStyle = '#f28c28';
    mctx.fill();
    mctx.lineWidth = 3;
    mctx.strokeStyle = '#14243b';
    mctx.stroke();
    mctx.restore();
    const a = player.yaw;
    const nx = W / 2 + Math.sin(a) * (W * 0.43);
    const ny = W / 2 - Math.cos(a) * (W * 0.43);
    mctx.beginPath();
    mctx.arc(nx, ny, 17, 0, Math.PI * 2);
    mctx.fillStyle = '#14243b';
    mctx.fill();
    mctx.fillStyle = '#fff';
    mctx.font = '700 22px "Barlow Semi Condensed", sans-serif';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillText('K', nx, ny + 1);
  }

  // ------------------------------------------------------------------ update
  let acc = 0;
  let clockAcc = 0;
  let frame = 0;
  const clockText = $('#clock-text');
  const clockDate = $('#clock-date');
  const clockIcon = $('#clock-icon');
  const fpsEl = $('#fps');
  ui.update = (dt) => {
    if (!ui.running) return;
    frame++;
    clockAcc += dt;
    if (ui.timeScale > 0 && !ui.menu) {
      sim.clock.timeScale = ui.timeScale;
      sim.clock.advance((dt * ui.timeScale) / 3600);
    }
    if (clockAcc > 0.4) {
      clockAcc = 0;
      clockText.textContent = fmtClock(sky.hours);
      clockDate.innerHTML = `${fmtShort(sim.clock.date)} <b>${sim.clock.info.text}</b>`;
      clockIcon.innerHTML = sky.sunAlt > 0 ? SUN_SVG : MOON_SVG;
      fpsEl.textContent = sim.fps ? `${sim.fps} kare/sn` : '';
    }
    if (ui.hud) {
      drawCompass();
      if (ui.minimap && frame % 2 === 0) drawMinimap();
      updateLabels();
    }
    acc += dt;
    if (acc > 0.14) {
      acc = 0;
      updatePlace();
      if (ui.hud) updateCard();
      setPrompt(ui.menu ? null : findPrompt());
    }
    if (ui.menu === 'map') {
      const cv = $('#map-canvas');
      if (cv && frame % 6 === 0) drawBigMap(cv);
    }
  };

  // Escape while the settings panel is closed, etc. is handled above. Public helpers:
  ui.groups = groups;
  return ui;
}
