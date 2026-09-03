/**
 * SHA-256 над байтами — тот же отпечаток, что печатает `shasum -a 256` и что
 * кладёт в указатель `CryptoKit.SHA256` на стороне приложения.
 *
 * **Почему своя реализация, а не `crypto.subtle`.** Штатный `crypto.subtle`
 * есть в браузере — но только в «безопасном контексте», и доступность его в
 * настольном Obsidian (Electron, своя схема `app://`) и в мобильном (WebView)
 * мы НЕ МЕРИЛИ. Обещать «сойдётся» на непроверенном — ровно та ошибка, из-за
 * которой в этом проекте заведено правило «не строй того, что нечем
 * проверить». Своя реализация не зависит от среды вовсе: она считает то же
 * самое в тестах, в Electron и в WebView.
 *
 * Второй довод, который был бы первым, если бы не первый: `crypto.subtle
 * .digest` асинхронный, а сверка отпечатка стоит посреди чтения десятка файлов
 * подряд.
 *
 * **Это не «своя криптография».** Здесь нет ни одного собственного решения:
 * FIPS 180-4, §5.1.1 и §6.2, дословно — те же восемь начальных значений, те же
 * 64 постоянные, тот же порядок действий. И проверяется он не на словах: все
 * отпечатки в указателях образцов (`test/fixtures`) посчитаны CryptoKit, и
 * если эта функция считает иначе, разбор снимка краснеет целиком.
 */

/** Первые 32 бита дробных частей кубических корней первых 64 простых чисел. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Первые 32 бита дробных частей квадратных корней первых восьми простых. */
const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * Отпечаток байтов строкой из 64 шестнадцатеричных знаков в нижнем регистре —
 * ровно в том виде, в каком он лежит в указателе.
 */
export function sha256Hex(bytes: Uint8Array): string {
  // Дополнение по §5.1.1: бит `1`, нули, и длина сообщения В БИТАХ 64-битным
  // числом со старшего конца.
  const blocks = Math.floor((bytes.length + 8) / 64) + 1;
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  // Старшее слово длины берётся делением, а не сдвигом: сдвиги в JavaScript
  // работают над 32 битами, и файл больше 512 МБ дал бы неверную длину — то
  // есть неверный отпечаток ровно там, где проверить его труднее всего.
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);

  const hash = new Uint32Array(INITIAL);
  const w = new Uint32Array(64);

  for (let block = 0; block < blocks; block += 1) {
    const offset = block * 64;
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  let out = "";
  for (let i = 0; i < 8; i += 1) out += hash[i].toString(16).padStart(8, "0");
  return out;
}
