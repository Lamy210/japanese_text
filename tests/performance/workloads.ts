/**
 * Deterministic UTF-16 workloads for analysis benchmarks. Generated text is
 * synthetic and never represents private user content or real-world latency.
 */
export type WorkloadKind = 'prose' | 'markdown' | 'repetition' | 'long-sentence'

const FRAGMENTS: Record<WorkloadKind, string> = {
  prose: '本日の作業では設計を確認しました。仕様との整合性を調査し、必要な改善点を整理しました。\n',
  markdown: '# 作業報告\n説明文を確認します。 [参考](https://example.com/document)\n\n```ts\nconst message = "確認";\n```\n',
  repetition: 'また、確認を実施しました。さらに、検討を行いました。加えて、結果について、について報告しました。\n',
  'long-sentence': '資料に含まれる各種の内容や変更履歴を順番に確認しながら、必要となる追加の要件を整理して、'
}

export const BENCHMARK_LENGTHS = [1_000, 10_000, 50_000, 100_000] as const
export const BENCHMARK_WORKLOADS: readonly WorkloadKind[] =
  ['prose', 'markdown', 'repetition', 'long-sentence']

export function createWorkload(kind: WorkloadKind, utf16Length: number): string {
  if (!Number.isSafeInteger(utf16Length) || utf16Length < 1 || utf16Length > 1_000_000) {
    throw new Error('Invalid UTF-16 benchmark length')
  }
  const fragment = FRAGMENTS[kind]
  const repeatCount = Math.ceil(utf16Length / fragment.length)
  return fragment.repeat(repeatCount).slice(0, utf16Length)
}

export interface LatencySummary {
  count: number
  minMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

export function summarizeLatency(samplesMs: readonly number[]): LatencySummary {
  if (samplesMs.length === 0 || samplesMs.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error('At least one finite nonnegative latency sample is required')
  }
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const rank = (percentile: number) =>
    sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]!
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    p50Ms: rank(0.5),
    p95Ms: rank(0.95),
    p99Ms: rank(0.99),
    maxMs: sorted[sorted.length - 1]!
  }
}
