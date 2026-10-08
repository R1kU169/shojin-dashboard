// シードつきの乱数。同じ入力形式・制約・ケースからは同じ入力ができるようにする。

/** 文字列から32ビットのシードを作る(FNV-1a) */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** [0, 1) の一様乱数(mulberry32) */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [lo, hi] の整数(Number の範囲で使う) */
  int(lo: number, hi: number): number {
    return hi <= lo ? lo : lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** [lo, hi] の整数(BigInt)。幅が 2^32 を超えるときは32ビットずつ作って棄却する */
  big(lo: bigint, hi: bigint): bigint {
    if (hi <= lo) return lo;
    const span = hi - lo + 1n;
    if (span <= 0x100000000n) return lo + BigInt(Math.floor(this.next() * Number(span)));
    const bits = span.toString(2).length;
    for (;;) {
      let x = 0n;
      for (let b = 0; b < bits; b += 32) x = (x << 32n) | BigInt(Math.floor(this.next() * 4294967296));
      x &= (1n << BigInt(bits)) - 1n;
      if (x < span) return lo + x;
    }
  }

  /** 配列をその場で混ぜる */
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
}
