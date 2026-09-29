// Little discoverable things around the campus. Every egg is tagged as "Gerçek" (the fact is
// backed by a public source, the prop itself is a design choice) or "Kurgu" (pure fiction).
// Sources come from the research in data/research/visual_and_lore.json.

import * as THREE from 'three';
import { clamp } from './util.js';

const KIND = { real: 'Gerçek', fiction: 'Kurgu' };

const QUOTES = [
  'Ders programın bugün seni bekliyor ama çayın soğumadan içilmeli.',
  'Sınav zor değil, sadece cesur.',
  'Bir bölüm daha, sonra kahve. (Kanıtlanmamış ama işe yarıyor.)',
  'Yarın yapılacak iş, bugün not edilen iştir.',
  'Kütüphanede sessizlik altındır, çay demirdir.',
  'Proje teslimi yarın demek, bugün başlamak demek değildir. Yine de başla.',
  'Bir kedi sana bakıyorsa ders çalışıyorsun demektir.',
  'Devamsızlık hakkını kullanma; ama kullandıysan da kimseye söyleme.',
];
const HOMEWORK = [
  'Bulan kişi teşekkür bekliyor: "Ödevim rüzgarla uçtu, size minnettarım."',
  'Sayfanın kenarında not var: "Kaynakça sonra, önce kahve."',
  'Kayıp sayfa teslim edildi. Kimliği belirsiz bir öğrenci uzaktan el salladı.',
  'Sayfada sadece tek cümle yazıyor: "Sonuç: yarın erteledim."',
];

const soft = (color, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export class Easter {
  constructor({ data, hf, scene, collision, buildings, props, navgrid, boundary, sim }) {
    this.data = data;
    this.hf = hf;
    this.scene = scene;
    this.collision = collision;
    this.buildings = buildings;
    this.props = props;
    this.nav = navgrid;
    this.boundary = boundary;
    this.sim = sim;
    this.group = new THREE.Group();
    this.group.name = 'easter';
    scene.add(this.group);
    this.eggs = [];
    this.fx = [];
    this.time = 0;
    this.found = new Set();
    try {
      for (const id of JSON.parse(localStorage.getItem('ieu-eggs') || '[]')) this.found.add(id);
    } catch (e) {
      /* storage may be blocked */
    }
    this._build();
  }

  // ---------------------------------------------------------------------- helpers
  _doorOf(name) {
    const b = this.buildings.all.find((x) => x.name === name);
    if (!b) return { b: null, door: null };
    // The entrance nearest the campus centre faces the plaza side.
    const doors = this.data.doors.filter((d) => d.b === b.id).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    return { b, door: doors[0] || null };
  }

  // A free ground point near (x, z) that is not inside a building or on a collider.
  _free(x, z, r = 0.7) {
    for (let k = 0; k < 24; k++) {
      const a = k * 2.399;
      const d = k === 0 ? 0 : 0.6 + k * 0.25;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (this.buildings.all.some((b) => this._inBuilding(b, px, pz))) continue;
      if (this.collision.resolve(px, pz, r).hit) continue;
      return [px, pz];
    }
    return [x, z];
  }

  _inBuilding(b, x, z) {
    const bb = b.bb || (b.bb = { minX: Math.min(...b.ring.filter((_, i) => i % 2 === 0)), maxX: Math.max(...b.ring.filter((_, i) => i % 2 === 0)), minZ: Math.min(...b.ring.filter((_, i) => i % 2 === 1)), maxZ: Math.max(...b.ring.filter((_, i) => i % 2 === 1)) });
    if (x < bb.minX - 1 || x > bb.maxX + 1 || z < bb.minZ - 1 || z > bb.maxZ + 1) return false;
    let inside = false;
    const n = b.ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = b.ring[i * 2];
      const zi = b.ring[i * 2 + 1];
      const xj = b.ring[j * 2];
      const zj = b.ring[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  _place(mesh, x, z, yaw = 0, lift = 0) {
    mesh.position.set(x, this.hf.h(x, z) + lift, z);
    mesh.rotation.y = yaw;
    this.group.add(mesh);
    mesh.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return mesh;
  }

  _add(egg) {
    egg.radius = egg.radius || 2.2;
    this.eggs.push(egg);
    if (egg.solid) this.collision.addCircle({ x: egg.x, z: egg.z, r: egg.solid });
  }

  // ------------------------------------------------------------------------ build
  _build() {
    this._tesla();
    this._hotelDesk();
    this._roomCodes();
    this._amfi();
    this._steam();
    this._phoneBox();
    this._catSign();
    this._vending();
    this._homework();
    this._gateSigns();
  }

  _tesla() {
    const { door } = this._doorOf('TESLA');
    if (!door) return;
    const [x, z] = this._free(door.x + door.nx * 3 - door.nz * 2, door.z + door.nz * 3 + door.nx * 2);
    const g = new THREE.Group();
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.62), soft('#4a4d54', 0.8));
    stone.position.y = 0.5;
    const bronze = soft('#9a7346', 0.35, 0.65);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), bronze);
    chest.scale.set(1, 0.7, 0.6);
    chest.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), bronze);
    head.scale.set(0.9, 1.15, 1);
    head.position.y = 1.5;
    const stache = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.05), soft('#5b4630', 0.5, 0.4));
    stache.position.set(0, 1.45, 0.15);
    g.add(stone, chest, head, stache);
    this._place(g, x, z, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'tesla', kind: 'real', title: 'Nikola Tesla büstü', x, z, solid: 0.45,
      text: 'TESLA binası Mayıs 2018\'de açıldı. Sırbistan\'ın İstanbul Başkonsolosluğu ve ABD\'deki Tesla Bilim Vakfı\'nın bağışladığı Nikola Tesla büstü yeni binaya yerleştirildi. (Büstün duruş yeri tasarım tercihidir.)',
      src: '25yil.ieu.edu.tr, resmî zaman çizelgesi',
      onUse: () => this._sparks(x, z, 1.5),
    });
  }

  _hotelDesk() {
    // Under the canopy of the main entrance: a reception bell and the guest book.
    const door = this.data.doors.find((d) => d.b === 154001110 && d.main);
    if (!door) return;
    const tx = -door.nz;
    const tz = door.nx;
    const bx = door.x + door.nx * 1.7 - tx * 3.8;
    const bz = door.z + door.nz * 1.7 - tz * 3.8;
    const desk = new THREE.Group();
    const wood = soft('#6b4a2f', 0.6);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), wood);
    top.position.y = 1.0;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.4), wood);
    legs.position.y = 0.5;
    const brass = soft('#c9a24a', 0.3, 0.8);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass);
    bell.position.set(0.1, 1.03, 0);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), brass);
    btn.position.set(0.1, 1.13, 0);
    desk.add(legs, top, bell, btn);
    this._place(desk, bx, bz, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'bell', kind: 'real', title: 'Resepsiyon zili', x: bx, z: bz, solid: 0.55,
      text: 'Kampüsün ana binası bir zamanlar Grand Plaza oteliydi. Dokuz yıl boş kaldıktan sonra 1 Temmuz 2001 kararıyla üniversiteye devredildi; güçlendirilip yenilendi. (Bu bilgi Vikipedi ve bir gazete yazısında geçiyor, resmî tarihçe sayfasında yok: orta güvenli. Zil kurgusal bir nesnedir.)',
      src: 'tr.wikipedia.org, Hürriyet 2024',
      onUse: () => this._chime(),
    });
    const gx = door.x + door.nx * 1.7 + tx * 3.8;
    const gz = door.z + door.nz * 1.7 + tz * 3.8;
    const stand = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.0, 10), soft('#3a3f47', 0.5, 0.4));
    post.position.y = 0.5;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.4), soft('#2a2f36', 0.5));
    slab.position.y = 1.04;
    slab.rotation.x = -0.35;
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.3), soft('#f0ead8', 0.9));
    book.position.y = 1.08;
    book.rotation.x = -0.35;
    stand.add(post, slab, book);
    this._place(stand, gx, gz, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'guestbook', kind: 'real', title: 'Konuk defteri', x: gx, z: gz, solid: 0.4,
      text: '2007\'de Galler Prensi (Prens Charles) üniversiteye konuk oldu: laboratuvarları gezdi, derslere katıldı ve konuk defterini imzaladı. (Ziyaret resmî 25. yıl zaman çizelgesinde yer alıyor; defter standı kurgusaldır.)',
      src: '25yil.ieu.edu.tr, 2007 girdisi',
    });
  }

  _roomCodes() {
    const door = this.data.doors.find((d) => d.b === 154001110 && d.main);
    if (!door) return;
    const x = door.x + door.nx * 1.9 - door.nz * 7.5;
    const z = door.z + door.nz * 1.9 + door.nx * 7.5;
    const board = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#14243b';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#f28c28';
    g.fillRect(0, 0, 512, 10);
    g.fillStyle = '#ffffff';
    g.font = '700 34px "Barlow Semi Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('ODA KODU NASIL OKUNUR?', 256, 70);
    g.font = '600 28px "Barlow", sans-serif';
    g.fillText('C 601: C Blok, 6. kat, Simülasyon Lab.', 256, 130);
    g.fillText('D 201: D Blok, 2. kat, CAD Lab.', 256, 170);
    g.fillText('İlk rakam kattır. Zemin kat 0.', 256, 220);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    panel.position.y = 1.45;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.61, 0.04), soft('#2a2f36', 0.5));
    frame.position.set(0, 1.45, -0.03);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), soft('#2a2f36', 0.5));
    leg.position.y = 0.6;
    board.add(frame, panel, leg);
    this._place(board, x, z, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'codes', kind: 'real', title: 'Oda kodu rehberi', x, z, solid: 0.3,
      text: 'Odaların kodu blok harfi ve üç rakamdan oluşur; ilk rakam katı gösterir (C 601: C Blok 6. kat Simülasyon Laboratuvarı, D 201: D Blok 2. kat CAD Lab). Bodrum katlarında blok harfinden sonra B gelir (DB 030). Kodlama düzeni resmî laboratuvar ve birim sayfalarından çıkarıldı; levha kurgusaldır.',
      src: 'comp.ieu.edu.tr, fecs.ieu.edu.tr, ffad.ieu.edu.tr',
    });
  }

  _amfi() {
    const { b, door } = this._doorOf('Amfiteatr');
    if (!door) return;
    const [x, z] = this._free(door.x + door.nx * 2.2 - door.nz * 1.6, door.z + door.nz * 2.2 + door.nx * 1.6);
    const plaque = new THREE.Group();
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.16), soft('#565b62', 0.7));
    stone.position.y = 0.45;
    const brass = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.42), soft('#b98f3d', 0.35, 0.8));
    brass.position.set(0, 0.58, 0.085);
    plaque.add(stone, brass);
    this._place(plaque, x, z, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'amfi', kind: 'real', title: 'Açık Hava Gösteri Merkezi', x, z, solid: 0.5,
      text: '28 Mayıs 2007\'de törenle açıldı: 1.600 kişilik seyir alanı, çelik çatı altında 11 x 24 m sahne ve orkestra çukuru. Konserler, dans gösterileri ve mezuniyet törenleri burada yapılıyor. Geceleri sahne ışıkları yanar. (Plaket kurgusaldır, bilgiler resmî duyuru ve teknik belgedendir.)',
      src: 'ieu.edu.tr haber 2007, kim.ieu.edu.tr',
    });
    // Night beams over the stage roof.
    if (b) {
      const beams = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#ffe2a8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 14, 1, true), mat);
        cone.position.set((i - 1) * 4.5, 4.5, 0);
        beams.add(cone);
      }
      const bx = b.c[0];
      const bz = b.c[1];
      beams.position.set(bx, this.hf.h(bx, bz) + 3.6, bz);
      this.group.add(beams);
      this.fx.push({ kind: 'beams', mat });
    }
  }

  _steam() {
    const dorm = this.buildings.all.find((x) => x.cat === 'dorm');
    if (!dorm) return;
    const door = this.data.doors.filter((d) => d.b === dorm.id).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
    if (!door) return;
    const [x, z] = this._free(door.x + door.nx * 3.4 - door.nz * 4, door.z + door.nz * 3.4 + door.nx * 4);
    const vent = new THREE.Group();
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 12), soft('#9aa0a6', 0.4, 0.6));
    pipe.position.y = 0.3;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 12), soft('#6d737a', 0.4, 0.6));
    cap.position.y = 0.62;
    vent.add(pipe, cap);
    this._place(vent, x, z);
    // Steam: a few soft sprites rising and fading.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const sprites = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      this.group.add(m);
      sprites.push({ m, t: i / 9 });
    }
    const base = this.hf.h(x, z) + 0.7;
    this.fx.push({ kind: 'steam', sprites, x, z, y: base });
    this._add({
      id: 'steam', kind: 'real', title: 'Jeotermal buhar', x, z, solid: 0.3,
      text: 'Yurt binasının ısıtması ve sıcak suyu jeotermal enerjiyle sağlanıyor (Balçova jeotermal bölgesi). Havalandırmadan çıkan buhar bu yüzden hiç eksik olmaz. (Baca kurgusaldır, ısıtma bilgisi yurt sayfasındandır.)',
      src: 'yurt.ieu.edu.tr',
    });
  }

  _phoneBox() {
    const lib = this.data.pois.find((p) => p.cat === 'library');
    const wing = this.buildings.all.find((b) => b.id === 154001110);
    if (!lib || !wing) return;
    const door = this.data.doors.find((d) => d.b === wing.id && d.x < -30 && d.z < 60);
    if (!door) return;
    const [x, z] = this._free(door.x + door.nx * 3.4 + door.nz * 3, door.z + door.nz * 3.4 - door.nx * 3);
    const box = new THREE.Group();
    const red = soft('#c0262d', 0.5);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.35, 0.95), red);
    body.position.y = 1.175;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.18, 1.05), red);
    roof.position.y = 2.42;
    const glass = new THREE.MeshStandardMaterial({ color: '#dfe9ef', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
    for (const [gx, gz, ry] of [[0, 0.48, 0], [0, -0.48, 0], [0.48, 0, Math.PI / 2], [-0.48, 0, Math.PI / 2]]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.5), glass);
      pane.position.set(gx, 1.35, gz);
      pane.rotation.y = ry;
      box.add(pane);
    }
    box.add(body, roof);
    this._place(box, x, z, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'phonebox', kind: 'real', title: 'Kırmızı telefon kulübesi', x, z, solid: 0.6,
      text: 'Kütüphane 2002\'de kuruldu; 2004\'te British Council Kütüphanesi ile birleşerek İngilizce kaynak hizmeti vermeye başladı. Bu kulübe buna küçük bir selam. (Kulübe kurgusaldır; kütüphane tarihi resmî kütüphane sayfasından.)',
      src: 'kutuphane.ieu.edu.tr/tr/tarihce',
    });
  }

  _catSign() {
    const park = this.data.pois.find((p) => p.name === 'IEU Kedili Park');
    if (!park) return;
    const [x, z] = this._free(park.x, park.z, 1);
    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), soft('#6b4a2f', 0.7));
    post.position.y = 0.55;
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = 192;
    const g = c.getContext('2d');
    g.fillStyle = '#f3efe4';
    g.fillRect(0, 0, 384, 192);
    g.fillStyle = '#14243b';
    g.font = '700 34px "Barlow Semi Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('KEDİ OFİS SAATLERİ', 192, 62);
    g.font = '600 26px "Barlow", sans-serif';
    g.fillText('Her gün, mama saatinde', 192, 110);
    g.fillText('(yoklama: bir pati)', 192, 148);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
    board.position.y = 1.2;
    sign.add(post, board);
    this._place(sign, x, z, 0.6);
    this._add({
      id: 'catsign', kind: 'fiction', title: 'Kedi ofis saatleri', x, z, solid: 0.25,
      text: 'Kedili Park\'ın sakinleri ofis saatlerinde basamaklara oturur, atıştırmalık karşılığında yoklama kâğıdına pati basar. Çok bilgili oldukları söylenir; sorulara cevap vermezler.',
      src: 'Şaka, kaynağı yok',
    });
  }

  _vending() {
    const { door } = this._doorOf('Starbucks');
    if (!door) return;
    const [x, z] = this._free(door.x + door.nx * 3.4 + -door.nz * -2.6, door.z + door.nz * 3.4 + door.nx * -2.6);
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.75), soft('#2a5d8a', 0.45));
    body.position.y = 0.95;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.2), new THREE.MeshStandardMaterial({ color: '#f0d9a8', emissive: '#ffcf7a', emissiveIntensity: 0.25, roughness: 0.5 }));
    face.position.set(0, 1.15, 0.38);
    m.add(body, face);
    this._place(m, x, z, Math.atan2(door.nx, door.nz));
    this._add({
      id: 'vending', kind: 'fiction', title: 'Söz veren otomat', x, z, solid: 0.6, radius: 2.4,
      text: '',
      src: 'Şaka, kaynağı yok',
      dynamic: () => QUOTES[Math.floor(Math.random() * QUOTES.length)],
    });
  }

  _homework() {
    const x = 18;
    const z = 90;
    const [fx, fz] = this._free(x, z, 0.4);
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), new THREE.MeshStandardMaterial({ color: '#f7f5ef', roughness: 0.9, side: THREE.DoubleSide }));
    page.position.set(fx, this.hf.h(fx, fz) + 0.6, fz);
    this.group.add(page);
    const egg = {
      id: 'homework', kind: 'fiction', title: 'Kayıp ödev sayfası', x: fx, z: fz, radius: 2.0,
      text: '', src: 'Şaka, kaynağı yok',
      dynamic: () => HOMEWORK[Math.floor(Math.random() * HOMEWORK.length)],
      mesh: page,
    };
    this._add(egg);
    this.fx.push({ kind: 'page', egg });
  }

  _gateSigns() {
    // The round red "DUR" sign the real vehicle barrier carries.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#d0202a';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff';
    g.font = '800 46px "Barlow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('DUR', 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false });
    for (const gt of this.boundary.gates) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), mat);
      const nxg = -gt.az;
      const nzg = gt.ax;
      s.position.set(gt.x + gt.ax * (gt.w / 2 + 0.6), this.hf.h(gt.x, gt.z) + 1.45, gt.z + gt.az * (gt.w / 2 + 0.6));
      s.rotation.y = Math.atan2(nxg, nzg);
      this.group.add(s);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8), soft('#7a7f86', 0.5, 0.5));
      pole.position.set(s.position.x, this.hf.h(gt.x, gt.z) + 0.75, s.position.z);
      this.group.add(pole);
    }
  }

  // ------------------------------------------------------------------------ fx
  _sparks(x, z, y) {
    const geo = new THREE.BufferGeometry();
    const pts = new Float32Array(6 * 2 * 3 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: '#7fb6ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, toneMapped: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    this.group.add(lines);
    this.fx.push({ kind: 'sparks', lines, x, z, y: this.hf.h(x, z) + y, life: 3 });
  }

  _chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this._ac || (this._ac = new AC());
      const t = ctx.currentTime;
      for (const [f, d] of [[1318, 0], [1760, 0.12]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2);
        o.connect(g).connect(ctx.destination);
        o.start(t + d);
        o.stop(t + d + 1.3);
      }
    } catch (e) {
      /* audio may be unavailable */
    }
  }

  update(dt, player, sky) {
    this.time += dt;
    for (const f of this.fx) {
      if (f.kind === 'beams') f.mat.opacity = clamp(sky.night - 0.2, 0, 1) * 0.16;
      else if (f.kind === 'steam') {
        for (const s of f.sprites) {
          s.t = (s.t + dt * 0.18) % 1;
          const u = s.t;
          s.m.position.set(f.x + Math.sin(u * 5 + s.t * 9) * 0.25, f.y + u * 4.2, f.z + Math.cos(u * 4) * 0.2);
          s.m.scale.setScalar(0.7 + u * 2.2);
          s.m.material.opacity = Math.sin(u * Math.PI) * 0.4;
        }
      } else if (f.kind === 'page') {
        const e = f.egg;
        const t = this.time;
        e.mesh.position.set(e.x + Math.sin(t * 0.7) * 0.4, this.hf.h(e.x, e.z) + 0.55 + Math.abs(Math.sin(t * 1.3)) * 0.35, e.z + Math.cos(t * 0.6) * 0.4);
        e.mesh.rotation.set(Math.sin(t * 1.9) * 0.9, t * 1.1, Math.cos(t * 1.4) * 0.7);
      } else if (f.kind === 'sparks') {
        f.life -= dt;
        const p = f.lines.geometry.attributes.position;
        for (let i = 0; i < 6; i++) {
          const a = this.time * 9 + i * 1.7;
          let px = f.x;
          let py = f.y;
          let pz = f.z;
          const dx = Math.cos(a + i) * 0.8;
          const dz = Math.sin(a * 1.3 + i) * 0.8;
          for (let k = 0; k < 4; k++) {
            const j = (i * 4 + k) * 6;
            p.array[j] = px;
            p.array[j + 1] = py;
            p.array[j + 2] = pz;
            px += dx * 0.25 + (Math.random() - 0.5) * 0.25;
            py += (Math.random() - 0.35) * 0.3;
            pz += dz * 0.25 + (Math.random() - 0.5) * 0.25;
            p.array[j + 3] = px;
            p.array[j + 4] = py;
            p.array[j + 5] = pz;
          }
        }
        p.needsUpdate = true;
        f.lines.material.opacity = clamp(f.life, 0, 1) * (0.6 + Math.random() * 0.4);
        if (f.life <= 0) {
          this.group.remove(f.lines);
          f.lines.geometry.dispose();
          f.done = true;
        }
      }
    }
    this.fx = this.fx.filter((f) => !f.done);
  }

  // ------------------------------------------------------------------ interaction
  // The prompt for the egg the player is looking at, if any.
  prompt(player, camera) {
    let best = null;
    let bd = 1e9;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    for (const e of this.eggs) {
      const dx = e.x - player.pos.x;
      const dz = e.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > e.radius || d >= bd) continue;
      if ((dx * fwd.x + dz * fwd.z) / (d || 1) < 0.35) continue;
      best = e;
      bd = d;
    }
    if (!best) return null;
    return { text: `İncele: ${best.title}`, action: () => this.use(best) };
  }

  use(e) {
    const text = e.dynamic ? e.dynamic() : e.text;
    if (e.onUse) e.onUse();
    const first = !this.found.has(e.id);
    this.found.add(e.id);
    try {
      localStorage.setItem('ieu-eggs', JSON.stringify([...this.found]));
    } catch (err) {
      /* storage may be blocked */
    }
    if (this.sim.ui && this.sim.ui.showEgg) this.sim.ui.showEgg({ ...e, text }, first, this.found.size, this.eggs.length);
  }

  get list() {
    return this.eggs.map((e) => ({ id: e.id, kind: KIND[e.kind], title: e.title, found: this.found.has(e.id) }));
  }
}
