import { describe, expect, it } from 'vitest'

import {
	detectValueStructure,
	formatJsonForHighlight,
	normalizeDelimiter,
	parseDelimiterSeparated,
	parseJsonValue,
	tokenizeJsonForHighlight,
} from './key-value-visualizer-utils'

describe('key-value-visualizer-utils', () => {
	it('detects JSON payloads', () => {
		const result = detectValueStructure('{"name":"jay","count":2}')
		expect(result.type).toBe('json')
	})

	it('does not auto-detect JSON primitives', () => {
		expect(detectValueStructure('2').type).toBe('raw')
		expect(detectValueStructure('"hello"').type).toBe('raw')
		expect(detectValueStructure('true').type).toBe('raw')
	})

	it('detects delimiter-separated payloads and guesses delimiter', () => {
		const result = detectValueStructure('id,name\n1,alice\n2,bob')
		expect(result.type).toBe('dsv')
		if (result.type === 'dsv') {
			expect(result.delimiter).toBe(',')
			expect(result.rows.length).toBe(3)
		}
	})

	it('falls back to raw when structure cannot be detected', () => {
		const result = detectValueStructure('single-line-value')
		expect(result.type).toBe('raw')
	})

	it('normalizes escaped tab delimiter input', () => {
		expect(normalizeDelimiter('\\t')).toBe('\t')
		expect(normalizeDelimiter(',')).toBe(',')
	})

	it('parses delimiter-separated rows with a selected delimiter', () => {
		const rows = parseDelimiterSeparated('a|b|c\n1|2|3', '|')
		expect(rows).toEqual([
			['a', 'b', 'c'],
			['1', '2', '3'],
		])
	})

	it('returns parser error for invalid JSON in JSON mode', () => {
		const parsed = parseJsonValue('{"incomplete":')
		expect(parsed.error).toBeTruthy()
	})

	it('formats structured json into tokenized pretty-printed lines', () => {
		const lines = formatJsonForHighlight({
			name: 'jay',
			count: 2,
			flags: [true, null],
		})

		expect(lines).toEqual([
			[{ text: '{', kind: 'punctuation' }],
			[
				{ text: '  ', kind: 'punctuation' },
				{ text: '"name": ', kind: 'key' },
				{ text: '"jay"', kind: 'string' },
				{ text: ',', kind: 'punctuation' },
			],
			[
				{ text: '  ', kind: 'punctuation' },
				{ text: '"count": ', kind: 'key' },
				{ text: '2', kind: 'number' },
				{ text: ',', kind: 'punctuation' },
			],
			[
				{ text: '  ', kind: 'punctuation' },
				{ text: '"flags": ', kind: 'key' },
				{ text: '[', kind: 'punctuation' },
			],
			[
				{ text: '    ', kind: 'punctuation' },
				{ text: 'true', kind: 'boolean' },
				{ text: ',', kind: 'punctuation' },
			],
			[
				{ text: '    ', kind: 'punctuation' },
				{ text: 'null', kind: 'null' },
			],
			[
				{ text: '  ', kind: 'punctuation' },
				{ text: ']', kind: 'punctuation' },
			],
			[{ text: '}', kind: 'punctuation' }],
		])
	})

	it('tokenizes raw json without changing spacing', () => {
		const lines = tokenizeJsonForHighlight('{"name":"jay","count":2}')

		expect(lines).toEqual([
			[
				{ text: '{', kind: 'punctuation' },
				{ text: '"name"', kind: 'key' },
				{ text: ':', kind: 'punctuation' },
				{ text: '"jay"', kind: 'string' },
				{ text: ',', kind: 'punctuation' },
				{ text: '"count"', kind: 'key' },
				{ text: ':', kind: 'punctuation' },
				{ text: '2', kind: 'number' },
				{ text: '}', kind: 'punctuation' },
			],
		])
	})
})
