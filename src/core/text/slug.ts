/**
 * GitHub風 見出しスラグ生成 — reference/broken-anchor・duplicate-anchor 検査に使用
 *
 * GitHub のアンカー生成アルゴリズムの近似実装:
 * 1. NFKC正規化  2. 小文字化  3. 記号除去 (英数字・ハイフン・空白・CJKは保持)
 * 4. 空白→ハイフン  5. 重複時は -1, -2 ... を付与
 */

export class Slugger {
  private readonly seen = new Map<string, number>()

  static normalize(heading: string): string {
    const normalized = heading.normalize('NFKC').toLowerCase()
    let out = ''
    for (const ch of normalized) {
      if (/[a-z0-9 _-]/.test(ch)) {
        out += ch === ' ' ? '-' : ch
      } else if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(ch)) {
        // かな・漢字・半角カナは保持
        out += ch
      }
      // その他の記号・絵文字等は除去
    }
    return out
  }

  /** 見出しテキストから一意スラグを生成 (重複時に -1, -2 を付与) */
  slug(heading: string): string {
    const base = Slugger.normalize(heading)
    if (base === '') {
      // 空スラグ (絵文字のみの見出し等) は "section" ベースに
      const emptyCount = this.seen.get('') ?? 0
      this.seen.set('', emptyCount + 1)
      return emptyCount === 0 ? 'section' : `section-${emptyCount}`
    }
    const count = this.seen.get(base) ?? 0
    this.seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }

  /** 正規化のみ (重複検出用にベーススラグを得る) */
  base(heading: string): string {
    return Slugger.normalize(heading)
  }
}
