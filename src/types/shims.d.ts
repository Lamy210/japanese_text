// textlintルール/プラグインパッケージの型shim (型定義を同梱していないため)
// 注意: このファイルを ambient module declarations として機能させるため
// トップレベル import は使わない (import type も不可)。
declare module 'textlint-rule-sentence-length' {
  const rule: { default: import('@textlint/kernel').TextlintRuleModule }
  export default rule
}
declare module 'textlint-rule-no-nfd' {
  const rule: { default: import('@textlint/kernel').TextlintRuleModule }
  export default rule
}
declare module 'textlint-rule-no-hankaku-kana' {
  const rule: { default: import('@textlint/kernel').TextlintRuleModule }
  export default rule
}
declare module '@textlint/textlint-plugin-markdown' {
  const plugin: { default: unknown }
  export default plugin
}
declare module '@textlint/textlint-plugin-text' {
  const plugin: { default: unknown }
  export default plugin
}
