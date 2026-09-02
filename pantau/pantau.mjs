#!/usr/bin/env node
/**
 * Pemantau mingguan Radar Hibah Kedokteran Tropis.
 *
 * Lapis 1  membaca katalog di index.html lalu menyusun laporan tenggat.
 * Lapis 2  mengambil halaman pendana di pantau/watchlist.json, membandingkan
 *          isinya dengan pemeriksaan sebelumnya, dan melaporkan baris baru
 *          yang mengandung kata kunci tenggat.
 *
 * Tidak ada dependensi eksternal. Butuh Node 20 atau lebih baru.
 * Keluaran ditulis ke pantau/laporan.md dan state disimpan di pantau/state.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "pantau");
const F_INDEX = path.join(ROOT, "index.html");
const F_WATCH = path.join(DIR, "watchlist.json");
const F_STATE = path.join(DIR, "state.json");
const F_OUT = path.join(DIR, "laporan.md");

const HARI_INI = new Date();
HARI_INI.setHours(0, 0, 0, 0);

const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const tglPanjang = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};
const hariKe = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  t.setHours(0, 0, 0, 0);
  return Math.round((t - HARI_INI) / 86400000);
};

/* ---------------------------------------------------------------- LAPIS 1 */

function bacaKatalog() {
  const html = readFileSync(F_INDEX, "utf8");
  const awal = html.indexOf("const KATALOG = [\n");
  if (awal === -1) throw new Error("Blok KATALOG tidak ditemukan di index.html");
  const akhir = html.indexOf("\n];", awal);
  const isi = html.slice(awal + "const KATALOG = [".length, akhir);
  return new Function(`return [${isi}]`)();
}

function laporanTenggat(katalog) {
  const berTenggat = katalog.filter((g) => g.tenggat);

  const lewatMingguIni = berTenggat
    .filter((g) => hariKe(g.tenggat) < 0 && hariKe(g.tenggat) >= -7)
    .sort((a, b) => hariKe(b.tenggat) - hariKe(a.tenggat));

  const dalam30 = berTenggat
    .filter((g) => hariKe(g.tenggat) >= 0 && hariKe(g.tenggat) <= 30)
    .sort((a, b) => hariKe(a.tenggat) - hariKe(b.tenggat));

  const dalam90 = berTenggat
    .filter((g) => hariKe(g.tenggat) > 30 && hariKe(g.tenggat) <= 90)
    .sort((a, b) => hariKe(a.tenggat) - hariKe(b.tenggat));

  const bulanIni = HARI_INI.getMonth() + 1;
  const bulanDepan = (bulanIni % 12) + 1;
  const siklusDekat = katalog.filter(
    (g) => !g.tenggat && Array.isArray(g.siklus) &&
           (g.siklus.includes(bulanIni) || g.siklus.includes(bulanDepan))
  );

  const kedaluwarsa = berTenggat.filter((g) => hariKe(g.tenggat) < -7);
  const belumCek = katalog.filter((g) => g.verifikasi === "belum");

  const baris = (g) => {
    const sisa = hariKe(g.tenggat);
    const rel = sisa >= 0 ? `${sisa} hari lagi` : `lewat ${Math.abs(sisa)} hari`;
    const tautan = g.url ? ` [halaman](${g.url})` : "";
    return `- **${g.nama}** (${g.pemberi}) - ${tglPanjang(g.tenggat)}, ${rel}. Peran: ${g.peran}.${tautan}`;
  };

  let out = "";

  out += `## Tenggat\n\n`;

  if (dalam30.length) {
    out += `### Tutup dalam 30 hari\n\n${dalam30.map(baris).join("\n")}\n\n`;
  } else {
    out += `### Tutup dalam 30 hari\n\nTidak ada.\n\n`;
  }

  if (dalam90.length) {
    out += `### Tutup dalam 31 sampai 90 hari\n\n${dalam90.map(baris).join("\n")}\n\n`;
  }

  if (lewatMingguIni.length) {
    out += `### Baru tutup minggu ini\n\n${lewatMingguIni.map(baris).join("\n")}\n\nEntri ini perlu diperbarui ke tanggal ronde berikutnya atau diubah jadi skema berulang.\n\n`;
  }

  if (siklusDekat.length) {
    out += `### Siklus historis jatuh bulan ini atau bulan depan\n\n`;
    out += siklusDekat
      .map((g) => {
        const bl = g.siklus.map((m) => BULAN[m - 1]).join(", ");
        const tautan = g.url ? ` [halaman](${g.url})` : "";
        return `- **${g.nama}** (${g.pemberi}) - biasanya bergerak di ${bl}. Peran: ${g.peran}.${tautan}`;
      })
      .join("\n");
    out += `\n\nBelum tentu sudah terbit. Periksa halaman pendananya.\n\n`;
  }

  out += `## Perawatan katalog\n\n`;
  out += `- ${kedaluwarsa.length} entri punya tenggat yang lewat lebih dari seminggu dan belum diperbarui.\n`;
  out += `- ${belumCek.length} entri masih berlabel belum diverifikasi`;
  out += belumCek.length ? `: ${belumCek.map((g) => g.nama).join(", ")}.\n` : `.\n`;
  out += `- Total katalog: ${katalog.length} skema.\n\n`;

  return out;
}

/* ---------------------------------------------------------------- LAPIS 2 */

const KATA_KUNCI = /(deadline|closing date|closes on|apply by|call for (proposals|applications|expressions)|submission deadline|now open|opens on|tenggat|batas akhir|batas waktu|pendaftaran dibuka|ditutup pada|pengumuman)/i;
const POLA_TANGGAL = /(\d{1,2}\s+(jan|feb|mar|apr|may|mei|jun|jul|aug|agu|sep|oct|okt|nov|dec|des)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;

function keTeks(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function sinyal(teks) {
  return [...new Set(
    teks
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 15 && l.length < 260)
      .filter((l) => KATA_KUNCI.test(l) && POLA_TANGGAL.test(l))
  )].slice(0, 40);
}

async function ambil(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "RadarHibahKedokteranTropis/1.0 (+https://github.com/erwanhartadi/radar-hibah-kedokteran-tropis)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "id,en;q=0.8",
      },
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const ct = r.headers.get("content-type") || "";
    if (!/html|text/i.test(ct)) return { error: `bukan halaman teks (${ct.split(";")[0]})` };
    return { html: await r.text() };
  } catch (e) {
    return { error: e.name === "AbortError" ? "waktu habis" : String(e.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

async function laporanHalaman() {
  const daftar = JSON.parse(readFileSync(F_WATCH, "utf8")).halaman;
  const state = existsSync(F_STATE) ? JSON.parse(readFileSync(F_STATE, "utf8")) : {};
  const berubah = [], stabil = [], gagal = [], baru = [];

  for (const h of daftar) {
    const hasil = await ambil(h.url);
    if (hasil.error) {
      gagal.push({ ...h, error: hasil.error });
      continue;
    }
    const teks = keTeks(hasil.html);
    const hash = createHash("sha256").update(teks).digest("hex").slice(0, 16);
    const sinyalBaru = sinyal(teks);
    const lama = state[h.url];

    if (!lama) {
      baru.push(h);
    } else if (lama.hash !== hash) {
      const sebelum = new Set(lama.sinyal || []);
      const tambahan = sinyalBaru.filter((s) => !sebelum.has(s));
      berubah.push({ ...h, tambahan, selisih: teks.length - (lama.panjang || 0) });
    } else {
      stabil.push(h);
    }

    state[h.url] = {
      hash,
      panjang: teks.length,
      sinyal: sinyalBaru,
      diperiksa: HARI_INI.toISOString().slice(0, 10),
    };
    await new Promise((r) => setTimeout(r, 900));
  }

  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(F_STATE, JSON.stringify(state, null, 2) + "\n");

  let out = `## Halaman pendana\n\n`;
  out += `${daftar.length} halaman diperiksa. ${berubah.length} berubah, ${stabil.length} tetap, ${baru.length} baru dipantau, ${gagal.length} gagal diambil.\n\n`;

  if (berubah.length) {
    out += `### Berubah sejak pemeriksaan terakhir\n\n`;
    for (const b of berubah) {
      const arah = b.selisih > 0 ? `bertambah ${b.selisih}` : `berkurang ${Math.abs(b.selisih)}`;
      out += `**[${b.nama}](${b.url})** - isi ${arah} karakter.\n`;
      if (b.tambahan.length) {
        out += `\nBaris bertanggal yang baru muncul:\n\n`;
        out += b.tambahan.slice(0, 6).map((s) => `> ${s}`).join("\n>\n");
        out += `\n`;
      } else {
        out += `\nTidak ada baris bertanggal baru. Kemungkinan hanya perubahan kecil seperti banner atau tanggal muat.\n`;
      }
      out += `\n`;
    }
    out += `Perubahan kecil sering muncul karena elemen dinamis di halaman, bukan karena ada panggilan baru. Prioritaskan yang punya baris bertanggal baru.\n\n`;
  } else {
    out += `Tidak ada halaman yang berubah minggu ini.\n\n`;
  }

  if (baru.length) {
    out += `### Mulai dipantau minggu ini\n\n${baru.map((h) => `- [${h.nama}](${h.url})`).join("\n")}\n\nPerubahannya baru bisa dilaporkan mulai pemeriksaan berikutnya.\n\n`;
  }

  if (gagal.length) {
    out += `### Gagal diambil\n\n${gagal.map((h) => `- [${h.nama}](${h.url}) - ${h.error}`).join("\n")}\n\nKalau sebuah halaman gagal berminggu-minggu, alamatnya mungkin sudah pindah. Perbarui di pantau/watchlist.json.\n\n`;
  }

  return out;
}

/* -------------------------------------------------------------------- MAIN */

const katalog = bacaKatalog();
const tanggal = `${HARI_INI.getDate()} ${BULAN[HARI_INI.getMonth()]} ${HARI_INI.getFullYear()}`;

let laporan = `Pemeriksaan otomatis ${tanggal}.\n\n`;
laporan += laporanTenggat(katalog);
laporan += await laporanHalaman();
laporan += `---\n\nLaporan ini dibuat otomatis oleh alur kerja \`pantau.yml\`. Ia tidak mengubah katalog. Untuk menambahkan skema baru, sunting blok \`KATALOG\` di \`index.html\`, atau tempel prompt riset ulang dari tab Perbarui data ke Claude.\n`;

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
writeFileSync(F_OUT, laporan);

const judul = `Pantau mingguan ${tanggal}`;
console.log(`::notice::${judul}`);
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `judul=${judul}\n`, { flag: "a" });
}
