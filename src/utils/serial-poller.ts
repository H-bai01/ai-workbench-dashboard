export interface SerialPollerOptions {
  task: () => unknown | Promise<unknown>
  getDelayMs: () => number
  isActive?: () => boolean
  onError?: (error: unknown) => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export interface SerialPoller {
  start: () => void
  stop: () => void
  reschedule: () => void
  runNow: () => Promise<void>
}

function normalizeDelay(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * Runs one polling task at a time and schedules the next run only after the
 * current task settles. Callers keep ownership of intervals and visibility
 * policy through getDelayMs(), so moving a loop here does not change its
 * product behaviour.
 */
export function createSerialPoller(options: SerialPollerOptions): SerialPoller {
  const isActive = options.isActive || (() => true)
  const onError = options.onError || (() => undefined)
  const setTimer = options.setTimer || setTimeout
  const clearTimer = options.clearTimer || clearTimeout

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true
  let inFlight: Promise<void> | null = null

  const clearScheduledRun = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const schedule = () => {
    clearScheduledRun()
    if (stopped || !isActive()) return
    timer = setTimer(() => {
      timer = null
      void run()
    }, normalizeDelay(options.getDelayMs()))
  }

  const run = (): Promise<void> => {
    if (stopped || !isActive()) return Promise.resolve()
    if (inFlight) return inFlight

    clearScheduledRun()
    const currentRun = Promise.resolve()
      .then(async () => {
        await options.task()
      })
      .catch(onError)
      .finally(() => {
        inFlight = null
        schedule()
      })
    inFlight = currentRun
    return currentRun
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      schedule()
    },
    stop() {
      stopped = true
      clearScheduledRun()
    },
    reschedule() {
      if (stopped) return
      schedule()
    },
    runNow: run,
  }
}
