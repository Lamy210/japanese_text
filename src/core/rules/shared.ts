/**
 * 正規表現ヘルパー — ルール実装で共有する文字クラスとユーティリティ
 */

/** 仮名 (ひらがな・カタカナ・半角カナ) */
export const KANA = '\\u3040-\\u30ff\\uff66-\\uff9f'
/** 漢字 (CJK統合漢字 + 拡張A) */
export const KANJI = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
/** 日本語文字 (仮名 + 漢字) */
export const JP = `${KANA}${KANJI}`

/** 日本語文字クラスの文字列ビルダー (new RegExp 用) */
export const JP_CLASS = `[${JP}]`

/** 正規表現特殊文字のエスケープ */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 文字が日本語文字か */
export function isJapanese(ch: string | undefined): boolean {
  if (ch === undefined || ch.length === 0) return false
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xff66 && code <= 0xff9f) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  )
}

/** 行がMarkdown見出しか */
export function isHeadingLine(line: string): boolean {
  return /^ {0,3}#{1,6}\s/.test(line)
}

/** マッチ範囲 [start, end) の行情報文字列 (デバッグ・テスト用) */
export function sliceSafe(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start), Math.min(text.length, end))
}
