export type ApiRequestErrorCode = 'network_error' | 'invalid_response' | 'request_failed'

export class ApiRequestError extends Error {
  readonly code: ApiRequestErrorCode
  readonly status: number

  constructor(code: ApiRequestErrorCode, status = 0) {
    const message = code === 'network_error'
      ? '网络请求失败'
      : code === 'invalid_response'
        ? '服务响应格式无效'
        : '服务请求失败'
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

export interface JsonResponse<T> {
  ok: boolean
  status: number
  data: T
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<JsonResponse<T>> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch {
    throw new ApiRequestError('network_error')
  }

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json() as T,
    }
  } catch {
    throw new ApiRequestError('invalid_response', response.status)
  }
}

export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const result = await fetchJson<T>(input, init)
  if (!result.ok) throw new ApiRequestError('request_failed', result.status)
  return result.data
}
