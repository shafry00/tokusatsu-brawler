# Tokusatsu Brawler: Landing Page

Landing page statis untuk **Tokusatsu Brawler**, game aksi bergaya tokusatsu yang langsung jalan di browser.

- Demo game: https://ultraman-nine-trials.pages.dev/
- Kode game: https://github.com/shafry00/tokusatsu-brawler

## Isi halaman

Hero, fitur, jurus (kontrol), cara main, 9 level, cerita di balik game (2-3 bulan jadi 1 hari, game kedua < 12 jam), dan ajakan main.

## Struktur

```
index.html
css/style.css
js/main.js
favicon.svg
assets/img/    # screenshot dari game sendiri
```

Tanpa build step, tanpa dependensi. Font (Rubik, JetBrains Mono) dimuat dari Google Fonts.

## Jalankan lokal

```
python3 -m http.server 8000
```

Buka http://localhost:8000

## Deploy ke Cloudflare Pages

1. Pages > Create > Connect to Git, pilih repo ini.
2. Build command: kosongkan. Output directory: `/` (root).
3. Deploy.

Bisa juga di GitHub Pages atau hosting statis lain.

## Kredit gambar

Semua gambar di `assets/img/` adalah tangkapan layar dari game Tokusatsu Brawler sendiri. Gaya tampilan (langit pastel, kartu kaca, aksen mawar) terinspirasi dari referensi desain, tanpa memakai aset aslinya.

## Disclaimer

Proyek fan tidak resmi. Tidak berafiliasi, didukung, atau disponsori oleh Tsuburaya Productions. Nama dan karakter yang muncul di game adalah merek dagang pemiliknya masing-masing.
