import { describe, expect, it } from 'vitest'

import type { IpcResponseEnvelope } from '../../../shared/ipc/contracts'

import { RendererOperationError, unwrapResponse } from './ipc'

describe('unwrapResponse', () => {
  it('returns response data for ok envelopes', () => {
    const response: IpcResponseEnvelope<{ value: string }> = {
      ok: true,
      correlationId: 'corr-1',
      data: {
        value: 'ready',
      },
    }

    expect(unwrapResponse(response)).toEqual({
      value: 'ready',
    })
  })

  it('preserves code, retryable, and details for error envelopes', () => {
    const response: IpcResponseEnvelope<never> = {
      ok: false,
      correlationId: 'corr-2',
      error: {
        code: 'CONNECTION_FAILED',
        message: 'Connection dropped.',
        retryable: true,
        details: {
          connectionId: 'conn-1',
        },
      },
    }

    try {
      unwrapResponse(response)
      throw new Error('Expected unwrapResponse to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RendererOperationError)
      expect((error as RendererOperationError).code).toBe('CONNECTION_FAILED')
      expect((error as RendererOperationError).retryable).toBe(true)
      expect((error as RendererOperationError).details).toEqual({
        connectionId: 'conn-1',
      })
    }
  })

  it('formats validation issue details into a readable message', () => {
    const response: IpcResponseEnvelope<never> = {
      ok: false,
      correlationId: 'corr-3',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload.',
        retryable: false,
        details: {
          issues: [
            {
              path: ['payload', 'profile', 'name'],
              message: 'Invalid input',
            },
            {
              path: ['payload', 'profile', 'port'],
              message: 'Expected number',
            },
          ],
        },
      },
    }

    try {
      unwrapResponse(response)
      throw new Error('Expected unwrapResponse to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RendererOperationError)
      expect((error as RendererOperationError).message).toBe(
        'payload.profile.name: Invalid input; payload.profile.port: Expected number',
      )
    }
  })
})
