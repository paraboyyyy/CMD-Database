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
  - Tema terang dan gelap otomatis

## Arsitektur

```
frontend/   React + TypeScript + Vite, Three.js (viewer), parser CIF/POSCAR/XYZ sisi klien
backend/    FastAPI + SQLAlchemy, pymatgen + spglib (parsing, simetri, konversi format)
data/       contoh file struktur (dipakai viewer dan tes)
```

Database memakai PostgreSQL (kolom JSONB) di produksi dan SQLite untuk pengembangan lokal.

## Menjalankan

### Dengan Docker (paling mudah)

```bash
docker compose up --build
```

- Web: http://localhost:8080
- API + dokumentasi interaktif: http://localhost:8000/docs

Data contoh (17 struktur kristal klasik) otomatis dimasukkan saat backend start.

### Tanpa Docker (untuk pengembangan)

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m scripts.seed_samples        # isi data contoh ke SQLite (cmd.db)
uvicorn app.main:app --reload         # http://localhost:8000
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

# Dari Materials Project (butuh API key gratis, lisensi data CC BY 4.0)
pip install mp-api
export MP_API_KEY=...
python -m scripts.import_mp --chemsys Li-Fe-O
python -m scripts.import_mp --elements Si --max 200 --stable-only

# Dari folder file CIF/POSCAR (misalnya unduhan COD atau hasil perhitungan lab)
python -m scripts.import_files path/ke/folder --source cod
```

Import bersifat *upsert* berdasarkan `(source, source_id)`, jadi aman dijalankan ulang.
Pakai `CMD_DATABASE_URL` untuk memilih database, misalnya
`postgresql+psycopg://user:pass@host:5432/cmd`.

## API

| Endpoint | Fungsi |
|---|---|
| `GET /api/materials` | Cari: `q`, `formula`, `elements`, `exclude_elements`, `chemsys`, `spacegroup_number`, `crystal_system`, `nelements_min/max`, `band_gap_min/max`, `sort`, `order`, `limit`, `offset` |
| `GET /api/materials/{id}` | Detail lengkap termasuk struktur (format pymatgen) |
| `GET /api/materials/{id}/download?fmt=cif\|poscar\|xyz\|json` | Unduh struktur |
| `POST /api/parse` | Upload file struktur, kembalikan simetri dan kisi |

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
- [ ] Fase 7: deploy (domain, HTTPS, backup database)
