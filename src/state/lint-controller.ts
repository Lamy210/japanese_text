/**
 * Lint Controller — 仕様書 §24 (Worker通信/Revision) / §25 (3段階スケジューリング) / §26 (Worker障害)
 *
 * Tier 1: Immediate  — 入力後100ms以内 (fast rules)
 * Tier 2: Debounced  — 入力停止後150〜300ms (sentence rules / citation / Markdown / textlint)
 * Tier 3: Idle       — document-wide analysis (unused references / duplicate anchor)
 */

import type { LintRequest, LintTierResult, WorkerResponse } from '../worker/protocol'
import { isTierCompletion } from '../worker/revision-gate'
import { TierCompletionTracker, type TierCompletionMessage } from './tier-completion'
import { nextShadowLintRevision } from './shadow-revisions'
import type { RuleTier } from '../core/types'
import type { AppConfig } from '../core/config/schema'
import { appState } from './app-state'

const TIER1_DELAY_MS = 100
const TIER2_DELAY_MS = 250
const TIER3_IDLE_TIMEOUT_MS = 1500
const WORKER_WATCHDOG_MS = 10_000
const MAX_RESTART_ATTEMPTS = 3

const ALL_TIERS: RuleTier[] = ['fast', 'deep', 'idle']

interface PendingWait {
  tracker: TierCompletionTracker
  resolve: (results: Map<RuleTier, LintTierResult>) => void
  timer: ReturnType<typeof setTimeout>
}

type MessageHandler = (message: TierCompletionMessage) => void

class AnalysisWorkerClient {
  private worker: Worker | null = null
  private restartAttempts = 0

  start(): void {
    if (this.worker !== null) return
    try {
      const worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), {
        type: 'module'
      })
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data)
      })
      worker.addEventListener('error', (event) => {
        // §26: 1. UIをクラッシュさせない 2. Worker Errorを表示 3. 解析機能のみ停止 5. 再生成を試行
        event.preventDefault()
        this.handleWorkerFailure(`Workerでエラーが発生しました: ${event.message || 'unknown error'}`)
      })
      this.worker = worker
    } catch (error) {
      appState.setWorkerStatus('error')
      appState.setWorkerErrorMessage(
        `Workerを起動できませんでした: ${error instanceof Error ? error.message : String(error)}`
      )
      appState.setAnalysisStatus('off')
    }
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === 'ready') {
      appState.setWorkerStatus('ok')
      appState.setWorkerErrorMessage(null)
      appState.setSegmenterAvailable(message.segmenterAvailable)
      this.restartAttempts = 0
      return
    }
    if (!isTierCompletion(message)) return
    lintController.decrementInFlight()
    if (message.type === 'result') {
      // UIへの反映はrevision一致時のみ (§24: 最新revisionのみ表示)
      if (message.revision === appState.revision()) {
        appState.applyWorkerResult(message.tier, {
          revision: message.revision,
          diagnostics: message.diagnostics,
          ruleErrors: message.ruleErrors,
          durationMs: message.durationMs
        })
      }
    }
    // Promise待ち (lintAllNow / lintShadowText) への通知
    const handler = messageHandlers.get(message.revision)
    if (handler !== undefined) handler(message)
  }

  private handleWorkerFailure(message: string): void {
    appState.setWorkerStatus('error')
    appState.setWorkerErrorMessage(message)
    appState.setAnalysisStatus('error')
    this.terminate()
    if (this.restartAttempts < MAX_RESTART_ATTEMPTS) {
      this.restartAttempts++
      appState.pushToast(
        'warning',
        `解析Workerを再生成します (試行 ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS})`
      )
      setTimeout(() => {
        this.start()
        lintController.relintAll()
      }, 250)
    } else {
      appState.pushToast('error', '解析Workerの再生成に失敗しました。Editorは引き続き利用できます。')
    }
  }

  terminate(): void {
    if (this.worker !== null) {
      this.worker.terminate()
      this.worker = null
    }
  }

  restart(): void {
    this.restartAttempts = 0
    this.terminate()
    appState.setWorkerStatus('starting')
    this.start()
  }

  post(request: LintRequest): void {
    if (this.worker === null) {
      this.start()
      if (this.worker === null) return
    }
    this.worker.postMessage(request)
  }

  get running(): boolean {
    return this.worker !== null
  }
}

// ----------------------------------------------------------------
// 完了待ち管理 (lintAllNow / lintShadowText 用)
// ----------------------------------------------------------------
const messageHandlers = new Map<number, MessageHandler>()
const pendingWaits = new Map<number, PendingWait>()

function resolveIfComplete(revision: number): void {
  const entry = pendingWaits.get(revision)
  if (entry === undefined) return
  if (entry.tracker.complete) {
    clearTimeout(entry.timer)
    pendingWaits.delete(revision)
    messageHandlers.delete(revision)
    entry.resolve(entry.tracker.results)
  }
}

function registerWait(
  revision: number,
  tiers: RuleTier[],
  onMessage: MessageHandler
): Promise<Map<RuleTier, LintTierResult>> {
  return new Promise((resolve) => {
    const entry: PendingWait = {
      tracker: new TierCompletionTracker(tiers),
      resolve,
      timer: setTimeout(() => {
        pendingWaits.delete(revision)
        messageHandlers.delete(revision)
        resolve(entry.tracker.results)
      }, WORKER_WATCHDOG_MS)
    }
    pendingWaits.set(revision, entry)
    messageHandlers.set(revision, (message) => {
      onMessage(message)
      entry.tracker.record(message)
      resolveIfComplete(revision)
    })
  })
}

// ----------------------------------------------------------------
// Lint Controller 本体
// ----------------------------------------------------------------
class LintController {
  private tier1Timer: ReturnType<typeof setTimeout> | null = null
  private tier2Timer: ReturnType<typeof setTimeout> | null = null
  private idleHandle: number | null = null
  private inFlight = 0
  /** Consecutive manual Lint clicks for one revision share the same wait/Worker request. */
  private manualLintInFlight: {
    revision: number
    promise: Promise<Map<RuleTier, LintTierResult>>
  } | null = null
  private client = new AnalysisWorkerClient()
  private idleScheduler: {
    request: (cb: () => void, opts: { timeout: number }) => number
    cancel: (handle: number) => void
  }

  constructor() {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      this.idleScheduler = {
        request: (cb, opts) => window.requestIdleCallback(cb, opts),
        cancel: (h) => window.cancelIdleCallback(h)
      }
    } else {
      this.idleScheduler = {
        request: (cb, opts) => setTimeout(cb, Math.min(opts.timeout, 300)) as unknown as number,
        cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>)
      }
    }
    this.client.start()
  }

  /** 文書変更時のスケジューリング (§25) */
  scheduleLint(): void {
    // Tier 1: Immediate (入力後100ms以内)
    if (this.tier1Timer !== null) clearTimeout(this.tier1Timer)
    this.tier1Timer = setTimeout(() => {
      this.tier1Timer = null
      this.postLint(['fast'])
    }, TIER1_DELAY_MS)
    // Tier 2: Debounced (入力停止後250ms)
    if (this.tier2Timer !== null) clearTimeout(this.tier2Timer)
    this.tier2Timer = setTimeout(() => {
      this.tier2Timer = null
      this.postLint(['deep'])
    }, TIER2_DELAY_MS)
    // Tier 3: Idle (UI操作を阻害しないタイミング)
    if (this.idleHandle !== null) this.idleScheduler.cancel(this.idleHandle)
    this.idleHandle = this.idleScheduler.request(
      () => {
        this.idleHandle = null
        this.postLint(['idle'])
      },
      { timeout: TIER3_IDLE_TIMEOUT_MS }
    )
  }

  /** 設定変更時: 全tier即時再解析 */
  relintAll(): void {
    this.cancelTimers()
    this.postLint(ALL_TIERS)
  }

  /** 手動Lintボタン: 全tier即時 + 完了待ち */
  lintAllNow(): Promise<Map<RuleTier, LintTierResult>> {
    this.cancelTimers()
    const rev = appState.revision()
    // registerWait is revision-keyed. Registering it twice would overwrite the
    // first Promise's handler and leave that caller blocked until watchdog.
    const existing = this.manualLintInFlight
    if (existing?.revision === rev) return existing.promise
    const promise = registerWait(rev, ALL_TIERS, () => undefined)
    const entry = { revision: rev, promise }
    this.manualLintInFlight = entry
    void promise.then(() => {
      if (this.manualLintInFlight === entry) this.manualLintInFlight = null
    })
    this.postLint(ALL_TIERS)
    return promise
  }

  /** Format後テキストのShadow lint (§18.6: 新規Error確認。UIには反映しない) */
  lintShadowText(text: string): Promise<Map<RuleTier, LintTierResult>> {
    const shadowRevision = nextShadowLintRevision() // 負のrevisionはUIへ反映されない (§24)
    const promise = registerWait(shadowRevision, ALL_TIERS, () => undefined)
    this.inFlight += ALL_TIERS.length
    this.client.post({
      type: 'lint',
      revision: shadowRevision,
      text,
      config: cloneConfig(),
      docType: appState.docType(),
      tiers: ALL_TIERS
    })
    return promise
  }

  private postLint(tiers: RuleTier[]): void {
    this.inFlight += tiers.length
    appState.setAnalysisStatus('linting')
    this.client.post({
      type: 'lint',
      revision: appState.revision(),
      text: appState.documentText(),
      config: cloneConfig(),
      docType: appState.docType(),
      tiers
    })
  }

  private cancelTimers(): void {
    if (this.tier1Timer !== null) {
      clearTimeout(this.tier1Timer)
      this.tier1Timer = null
    }
    if (this.tier2Timer !== null) {
      clearTimeout(this.tier2Timer)
      this.tier2Timer = null
    }
    if (this.idleHandle !== null) {
      this.idleScheduler.cancel(this.idleHandle)
      this.idleHandle = null
    }
  }

  decrementInFlight(): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    if (this.inFlight === 0 && appState.analysisStatus() === 'linting') {
      appState.setAnalysisStatus('idle')
    }
  }

  restartWorker(): void {
    this.client.restart()
    setTimeout(() => this.relintAll(), 300)
  }

  get workerRunning(): boolean {
    return this.client.running
  }
}

function cloneConfig(): AppConfig {
  return JSON.parse(JSON.stringify(appState.config)) as AppConfig
}

export const lintController = new LintController()
