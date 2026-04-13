import { describe, expect, it } from 'vitest'

import {
	createEmptyKeyEditorDraft,
	parseKeyEditorDraftFromJson,
	serializeKeyEditorDraftToJson,
	validateRawJsonForDraftKind,
} from './key-upsert-dialog'

describe('key-upsert-dialog helpers', () => {
	it('serializes and parses hash drafts through raw JSON mode', () => {
		const draft = {
			...createEmptyKeyEditorDraft('hash'),
			hashEntries: [
				{ field: 'id', value: '123' },
				{ field: 'status', value: 'active' },
			],
		}

		const raw = serializeKeyEditorDraftToJson(draft)
		const parsed = parseKeyEditorDraftFromJson('hash', raw)

		expect(parsed.kind).toBe('hash')
		expect(parsed.hashEntries).toEqual([
			{ field: 'id', value: '123' },
			{ field: 'status', value: 'active' },
		])
	})

	it('validates malformed raw JSON by key type', () => {
		expect(validateRawJsonForDraftKind('zset', '{"bad":true}')).toBe(
			'Sorted set JSON must be an array.',
		)
	})
})
