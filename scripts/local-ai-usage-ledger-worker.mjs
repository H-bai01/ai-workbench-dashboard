import { parentPort, workerData } from 'node:worker_threads'
import { createLocalAiUsageLedgerStore } from './local-ai-usage-ledger.mjs'

function safeFaults(faults) {
  if (!Array.isArray(faults)) return []
  return faults
    .map((fault) => ({
      id: typeof fault?.id === 'string' ? fault.id.slice(0, 160) : '',
      source: typeof fault?.source === 'string' ? fault.source.slice(0, 80) : '',
      category: typeof fault?.category === 'string' ? fault.category.slice(0, 80) : '',
    }))
    .filter(fault => fault.id && fault.source && fault.category)
}

async function main() {
  try {
    // 文件发现、哈希和 JSONL 解析全部留在 Worker 内，HTTP 主线程只接收完成快照。
    const store = createLocalAiUsageLedgerStore({
      ledgerDir: workerData?.ledgerDir,
      retentionMs: workerData?.retentionMs,
      sources: workerData?.sources,
    })
    const snapshot = await store.refresh({
      force: Boolean(workerData?.force),
      freshMs: 0,
    })
    parentPort.postMessage({ ok: true, snapshot })
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      code: 'LOCAL_AI_LEDGER_WORKER_FAILED',
      faults: safeFaults(error?.faults),
    })
  } finally {
    parentPort.close()
  }
}

await main()
