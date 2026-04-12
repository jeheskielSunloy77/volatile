import type { IpcResponseEnvelope } from '@/shared/ipc/contracts'

export class RendererOperationError extends Error {
  public readonly code?: string

  public readonly retryable?: boolean

  public readonly details?: Record<string, unknown>

  public constructor(
    message: string,
    code?: string,
    retryable?: boolean,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'RendererOperationError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

type ValidationIssue = {
  message?: string
  path?: unknown
}

const formatValidationPath = (path: unknown): string => {
  if (!Array.isArray(path) || path.length === 0) {
    return ''
  }

  return path
    .map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : String(segment),
    )
    .join('.')
    .replace(/\.\[/g, '[')
}

const getRendererErrorMessage = (
  response: IpcResponseEnvelope<unknown>,
): string => {
  const fallbackMessage = response.error?.message ?? 'Operation failed.'
  const issues = (response.error?.details as { issues?: ValidationIssue[] } | undefined)
    ?.issues

  if (!Array.isArray(issues) || issues.length === 0) {
    return fallbackMessage
  }

  const summaries = issues
    .map((issue) => {
      const message = issue.message?.trim()

      if (!message) {
        return null
      }

      const path = formatValidationPath(issue.path)

      return path ? `${path}: ${message}` : message
    })
    .filter((summary): summary is string => Boolean(summary))

  if (summaries.length === 0) {
    return fallbackMessage
  }

  return summaries.join('; ')
}

export const unwrapResponse = <T>(response: IpcResponseEnvelope<T>): T => {
  if (!response.ok) {
    throw new RendererOperationError(
      getRendererErrorMessage(response),
      response.error?.code,
      response.error?.retryable,
      response.error?.details,
    )
  }

  if (response.data === undefined) {
    throw new RendererOperationError('Response did not include data.')
  }

  return response.data
}
