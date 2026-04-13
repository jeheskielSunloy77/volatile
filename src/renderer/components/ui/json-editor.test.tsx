import { describe, expect, it } from 'vitest'

import { JsonEditor } from './json-editor'

describe('JsonEditor', () => {
	it('exists as a reusable component', () => {
		expect(JsonEditor).toBeTypeOf('function')
	})
})
