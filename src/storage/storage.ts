/**
 * Storage Adapter — 仕様書 §27 (IndexedDB) / §28 (Auto Save / Privacy Mode) / §45 (feature detection)
 *
 * IndexedDBは大量の構造化データをクライアント側に保存可能で、Web Workerからも利用できる。
 * 保存対象: App Settings / Rule Settings / Presets / NG Words / Terminology / Recent Document / Editor Preferences
 * IndexedDBが利用できない環境ではメモリのみで動作し、EditorとBasic Lintは継続する (§45)。
 */

import type { AppConfig } from '../core/config/schema'
import type { DocumentType } from '../core/types'

const DB_NAME = 'japanese-writing-toolkit'
const DB_VERSION = 1
const SETTINGS_STORE = 'settings'
const DOCUMENTS_STORE = 'documents'
const CONFIG_KEY = 'app-config'
const RECENT_DOC_KEY = 'recent'

export interface StoredDocument {
  name: string
  content: string
  docType: DocumentType
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE)
      }
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        db.createObjectStore(DOCUMENTS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function put(storeName: string, key: string, value: unknown): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
      })
  )
}

function get<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDatabase().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly')
        const request = tx.objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result as T | undefined)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'))
      })
  )
}

function remove(storeName: string, key: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
      })
  )
}

/** 設定の保存 (§27) */
export function saveConfig(config: AppConfig): Promise<void> {
  return put(SETTINGS_STORE, CONFIG_KEY, config)
}

/** 設定の読み込み。不正なデータの場合は undefined を返しAppを落とさない (§30) */
export async function loadConfig(): Promise<AppConfig | undefined> {
  try {
    const raw = await get<unknown>(SETTINGS_STORE, CONFIG_KEY)
    if (raw === undefined) return undefined
    return raw as AppConfig
  } catch {
    return undefined
  }
}

/** 最近の文書の保存 (§28: Auto Save ON かつ Privacy Mode OFF のときのみ呼ぶ) */
export function saveRecentDocument(doc: StoredDocument): Promise<void> {
  return put(DOCUMENTS_STORE, RECENT_DOC_KEY, doc)
}

export function loadRecentDocument(): Promise<StoredDocument | undefined> {
  return get<StoredDocument>(DOCUMENTS_STORE, RECENT_DOC_KEY).catch(() => undefined)
}

/** Privacy Mode有効化時に本文を削除 (§28: 文書本文をIndexedDBへ保存しない) */
export function deleteRecentDocument(): Promise<void> {
  return remove(DOCUMENTS_STORE, RECENT_DOC_KEY).catch(() => undefined)
}
