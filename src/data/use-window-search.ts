import { useEffect, useState } from 'react'
import type { WindowInput, WindowSearch } from './eva-window'
import type { PlannerResult, PlannerTask } from './planner.worker'

export function useWindowSearch(input: WindowInput | null, sols: number, attempt: number) {
  const [result, setResult] = useState<{ input: WindowInput; search: WindowSearch } | null>(null)
  const [failed, setFailed] = useState<WindowInput | null>(null)
  useEffect(() => {
    if (!input) return
    setFailed(null)
    let worker: Worker | undefined
    // Rapid edits should settle before starting another six-week search.
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = ({ data }: MessageEvent<PlannerResult>) => {
          if (data.kind === 'windows') setResult({ input, search: data.search })
          worker?.terminate()
        }
        worker.onerror = () => { setFailed(input); worker?.terminate() }
        worker.postMessage({ kind: 'windows', input, sols } satisfies PlannerTask)
      } catch { setFailed(input) }
    }, 100)
    return () => { clearTimeout(timer); worker?.terminate() }
  }, [input, sols, attempt])
  return { search: result?.input === input ? result.search : null, failed: failed === input && input !== null }
}
