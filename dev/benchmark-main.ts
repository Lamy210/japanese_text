import {
  runBrowserWorkerBenchmark,
  type WorkerBenchmarkReport
} from '../src/dev/worker-benchmark'
import type { WorkerBenchmarkOptions } from '../src/dev/worker-benchmark'

const startButton = document.querySelector<HTMLButtonElement>('#start')
const downloadButton = document.querySelector<HTMLButtonElement>('#download')
const scopeSelect = document.querySelector<HTMLSelectElement>('#scope')
const status = document.querySelector<HTMLElement>('#status')
const cold = document.querySelector<HTMLElement>('#cold')
const results = document.querySelector<HTMLTableSectionElement>('#results')

if (!startButton || !downloadButton || !scopeSelect || !status || !cold || !results) {
  throw new Error('Benchmark page is missing required controls')
}

const start = startButton
const download = downloadButton
const scope = scopeSelect
const output = status
const coldLabel = cold
const table = results
let report: WorkerBenchmarkReport | null = null

function plan(): WorkerBenchmarkOptions {
  return scope.value === 'full'
    ? { workloads: ['prose', 'markdown', 'repetition', 'long-sentence'],
        lengths: [1000, 10000, 50000, 100000], iterations: 3, warmups: 1, timeoutMs: 90000 }
    : { workloads: ['prose', 'markdown'],
        lengths: [1000, 10000], iterations: 5, warmups: 2, timeoutMs: 60000 }
}

start.addEventListener('click', async () => {
  start.disabled = true
  download.disabled = true
  scope.disabled = true
  report = null
  table.replaceChildren()
  coldLabel.textContent = 'Cold Start: —'
  output.textContent = 'Workerを起動しています…'

  // Dedicated benchmark Worker: never shares request IDs or state with app UI.
  const worker = new Worker(new URL('../src/worker/analysis.worker.ts', import.meta.url), {
    type: 'module'
  })
  try {
    const result = await runBrowserWorkerBenchmark(
      worker,
      plan(),
      { userAgent: navigator.userAgent },
      (completed, total) => { output.textContent = `解析中 ${completed} / ${total}` }
    )
    report = result
    coldLabel.textContent = `Cold Start (初回lint往復): ${result.coldStartMs.toFixed(2)} ms`
    for (const row of result.rows) {
      const cells = [
        row.workload,
        String(row.utf16Length),
        row.roundTrip.p50Ms.toFixed(2),
        row.roundTrip.p95Ms.toFixed(2),
        row.roundTrip.p99Ms.toFixed(2),
        row.perTierRoundTrip.fast.p95Ms.toFixed(2),
        row.perTierRoundTrip.deep.p95Ms.toFixed(2),
        row.perTierRoundTrip.idle.p95Ms.toFixed(2),
        row.workerDuration.p50Ms.toFixed(2)
      ]
      const tr = document.createElement('tr')
      for (const value of cells) {
        const td = document.createElement('td')
        td.textContent = value
        tr.append(td)
      }
      table.append(tr)
    }
    output.textContent = `計測完了：${result.rows.length}条件、各${result.iterations}回。JSONをローカル保存できます。`
    download.disabled = false
  } catch (error) {
    output.textContent = `計測失敗：${error instanceof Error ? error.message : String(error)}`
  } finally {
    worker.terminate()
    scope.disabled = false
    start.disabled = false
  }
})

download.addEventListener('click', () => {
  if (!report) return
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'japanese-text-browser-worker-benchmark.json'
  anchor.click()
  URL.revokeObjectURL(url)
})
