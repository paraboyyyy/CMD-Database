# CMD Database

Database material berbasis web (mirip [Materials Project](https://next-gen.materialsproject.org)) dengan
viewer struktur kristal 3D di browser (mirip OpenMX Viewer).

- **Pencarian material**: berdasarkan formula (`Fe2O3`), sistem kimia (`Li-Co-O`), ID (`cmd-12`),
  unsur dari tabel periodik, dan sistem kristal. Hasil bisa diurutkan dan dibagi per halaman.
- **Halaman detail**: viewer 3D, simetri (space group, point group), parameter kisi, properti, dan
  unduhan CIF / POSCAR / XYZ / JSON.
- **Viewer standalone** (`/viewer`): buka file `.cif`, `POSCAR`/`CONTCAR`/`.vasp`, `.xyz` (termasuk
  trajektori multi-frame dan extended XYZ), atau JSON pymatgen. File dibaca langsung di browser.
  - Gaya ball-and-stick, space-filling, stick, dan wireframe
  - Supercell sampai 8×8×8, atom batas sel, unit cell, label, indikator sumbu a/b/c
  - Proyeksi perspektif atau ortografik, tampilan sepanjang a/b/c, ekspor PNG
  - Klik atom untuk koordinat fraksional, jarak, sudut, dan dihedral
  - Tombol *Find space group* (dianalisis oleh backend dengan spglib)
  - **Export input OpenMX (.dat)**: koordinat fraksional (`FRAC`) atau Kartesian (`Ang`), supercell,
    k-grid otomatis, XC, spin, cutoff, SCF atau optimasi geometri. Basis **Quick / Standard / Precise**
    terisi otomatis dari tabel PAO rekomendasi manual OpenMX (DFT_DATA19, H–Bi), termasuk pilihan VPS
    H/S untuk Fe, Co, Ni, Cu, Zn. Unsur di luar tabel diisi manual dan diingat browser.
    Opsi **DOS/PDOS** (`Dos.fileout`, rentang energi, k-grid), **band structure** (`Band.kpath` otomatis dari
    seekpath, ditransformasikan ke sel yang diekspor termasuk supercell), **spin collinear/noncollinear**
    dengan momen magnet awal per unsur, dan **SOC** (`scf.SpinOrbit.Coupling on`).
    Tersedia juga di halaman detail material.
  - Tema terang dan gelap otomatis
- **Builder** (`/builder`): buat material sendiri. Pilih space group (230, termasuk setting/origin choice),
  parameter kisi (otomatis dikunci sesuai sistem kristal), dan posisi atom yang tidak ekuivalen; atom
  ekuivalen dibangkitkan dengan operasi simetri spglib. Mulai dari template (FCC, BCC, HCP, intan, rock salt,
  CsCl, zinc blende, wurtzite, fluorite, perovskite, rutile, grafit, MoS2), material di database, atau file.
  Substitusi unsur, supercell, vakansi/doping (expand ke P1), deteksi simetri, peringatan atom bertumpuk,
  ekspor CIF/POSCAR/XYZ/OpenMX, dan "My structures" yang tersimpan di browser.
  - **Edit langsung di 3D**: seret atom dengan kursor (di space group selain P1 semua atom ekuivalen ikut
    bergerak), drag & drop unsur dari tabel periodik ke ruang kosong (tambah atom) atau ke atom (ganti
    unsur), mode kuas (klik unsur lalu klik di viewer), pilih + Delete untuk menghapus, snap ke grid 1/n.

## Arsitektur

```
frontend/   React + TypeScript + Vite, Three.js (viewer), parser CIF/POSCAR/XYZ sisi klien
backend/    FastAPI + SQLAlchemy, pymatgen + spglib (parsing, simetri, konversi format)
data/       contoh file struktur (dipakai viewer dan tes)
```

Database memakai PostgreSQL (kolom JSONB) di produksi dan SQLite untuk pengembangan lokal.

API yang berjalan di server sengaja dibuat ringan (FastAPI + SQLAlchemy + spglib, tanpa pymatgen),
supaya muat di fungsi serverless Vercel. pymatgen hanya dipakai oleh script import
(`backend/scripts/`), yang dijalankan dari komputer lokal atau GitHub Actions.

## Deploy production (Vercel + Neon)

1. **Import project**: di https://vercel.com/new pilih repo `CMD-Database`. Biarkan *Root Directory*
   kosong (root repo) dan *Framework Preset* **Other**. Semua pengaturan lain sudah ada di `vercel.json`.
   Klik **Deploy**.
2. **Database**: di project Vercel buka **Storage → Create Database → Neon (Postgres)**, lalu
   hubungkan ke project. Vercel otomatis menambahkan `DATABASE_URL`. Klik **Redeploy**.
   Saat pertama kali dipakai, API membuat tabel dan mengisi 17 struktur contoh.
   Tanpa database, situs tetap jalan dengan data contoh di SQLite sementara (`/tmp`).
3. **Isi data asli** lewat GitHub Actions:
   - Di GitHub: **Settings → Secrets and variables → Actions**, tambahkan `DATABASE_URL`
     (salin dari Neon/Vercel) dan `MP_API_KEY` (dari https://next-gen.materialsproject.org/api).
   - Buka tab **Actions → Import data → Run workflow**, isi misalnya `Li-Fe-O`, `elements:Si,O`, atau
     `all` dengan max `0` dan *stable only* untuk semua material stabil (muat di Neon gratis 0,5 GB).
     Import besar disimpan per batch; kalau terputus, jalankan lagi dan yang sudah masuk akan dilewati.
   - Setelah data asli masuk, jalankan workflow yang sama dengan pilihan `remove_demo_samples`, dan
     tambahkan environment variable `CMD_LOAD_DEMO_DATA=false` di Vercel.

Setiap push ke `main` otomatis di-deploy ulang oleh Vercel.

## Menjalankan

### Dengan Docker (paling mudah)

```bash
docker compose up --build
```

- Web: http://localhost:8080
- API + dokumentasi interaktif: http://localhost:8000/docs

Data contoh (17 struktur kristal klasik) otomatis dimasukkan ke database yang masih kosong.

### Tanpa Docker (untuk pengembangan)

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload         # http://localhost:8000, data contoh dimuat otomatis ke cmd.db
```

Frontend (Node 20+), di terminal lain:

```bash
cd frontend
npm install
npm run dev                           # http://localhost:5173 (proxy /api ke :8000)
```

## Mengisi database

```bash
cd backend
pip install -r requirements-ingest.txt

# Dari Materials Project (butuh API key gratis, lisensi data CC BY 4.0)
pip install mp-api
export MP_API_KEY=...
python -m scripts.import_mp --chemsys Li-Fe-O
python -m scripts.import_mp --elements Si --max 200 --stable-only
python -m scripts.import_mp --all --stable-only --max 0   # semua material stabil (puluhan ribu)

# Dari folder file CIF/POSCAR (misalnya unduhan COD atau hasil perhitungan lab)
python -m scripts.import_files path/ke/folder --source cod
```

Import bersifat *upsert* berdasarkan `(source, source_id)`, jadi aman dijalankan ulang.
Database dipilih lewat `CMD_DATABASE_URL` (atau `DATABASE_URL`), misalnya connection string dari Neon.
Hapus data contoh dengan `python -m scripts.remove_demo`.

`python -m scripts.seed_samples` membuat ulang `data/samples/` dan `backend/app/demo_materials.json`
(data contoh yang ikut dalam deploy).

## API

| Endpoint | Fungsi |
|---|---|
| `GET /api/materials` | Cari: `q`, `formula`, `elements`, `exclude_elements`, `chemsys`, `spacegroup_number`, `crystal_system`, `nelements_min/max`, `band_gap_min/max`, `sort`, `order`, `limit`, `offset` |
| `GET /api/materials/{id}` | Detail lengkap termasuk struktur (format pymatgen) |
| `GET /api/materials/{id}/download?fmt=cif\|poscar\|xyz\|json` | Unduh struktur |
| `POST /api/symmetry` | Space group dari sel (`lattice`, `frac`, `species`) memakai spglib |
| `GET /api/spacegroups` | 230 space group beserta setting-nya (nomor Hall) |
| `POST /api/build` | Bangkitkan sel lengkap dari space group (`hall`), parameter kisi, dan situs tak ekuivalen |
| `GET /api/elements?with=` | Jumlah material per unsur (untuk heatmap tabel periodik) |
| `POST /api/kpath` | Jalur k simetri tinggi (seekpath) dalam koordinat resiprokal sel yang dikirim |

## Tes

```bash
cd backend && pytest
cd frontend && npm test
```

## Roadmap

- [x] Fase 1: fondasi (monorepo, Docker Compose, PostgreSQL/SQLite, CI)
- [x] Fase 2: viewer standalone
- [x] Fase 3 (dasar): API pencarian, import Materials Project dan file lokal
- [x] Fase 4 (dasar): halaman detail material
- [ ] Fase 5: isosurface dari file `.cube` (densitas/orbital), plot band structure dan DOS,
      parser input/output OpenMX (`.dat`, `.md`, `.out`)
- [ ] Fase 6: akun pengguna, upload hasil perhitungan lewat web, data privat lab vs publik
- [x] Fase 7 (dasar): konfigurasi deploy Vercel + Neon, workflow import data
- [ ] Fase 7 lanjutan: domain sendiri, backup database
