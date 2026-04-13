export type VisualizerDataType = 'raw' | 'json' | 'dsv'
export type JsonTokenKind =
	| 'punctuation'
	| 'key'
	| 'string'
	| 'number'
	| 'boolean'
	| 'null'

export type JsonTokenSegment = {
	text: string
	kind: JsonTokenKind
}

export type JsonTokenLine = JsonTokenSegment[]

export type VisualizerDetection =
	| {
			type: 'raw'
	}
	| {
			type: 'json'
			value: unknown
	}
	| {
			type: 'dsv'
			delimiter: string
			rows: string[][]
			hasHeader: boolean
	}

const DELIMITER_CANDIDATES = [',', ';', '|', '\t']

const normalizeLines = (value: string): string[] =>
	value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)

export const normalizeDelimiter = (value: string): string => {
	if (value === '\\t') {
		return '\t'
	}

	if (value.length === 0) {
		return ','
	}

	return value
}

export const parseDelimiterSeparated = (
	value: string,
	delimiter: string,
): string[][] => {
	const lines = normalizeLines(value)
	if (lines.length === 0) {
		return []
	}

	return lines.map((line) => line.split(delimiter).map((cell) => cell.trim()))
}

const isNumericLike = (value: string): boolean => {
	if (value.trim().length === 0) {
		return false
	}

	const parsed = Number(value)
	return Number.isFinite(parsed)
}

const guessHasHeaderRow = (rows: string[][]): boolean => {
	if (rows.length < 2) {
		return false
	}

	const first = rows[0]
	const second = rows[1]
	const firstLooksLabelLike = first.every(
		(cell) => cell.length > 0 && !isNumericLike(cell),
	)
	const secondLooksDataLike = second.some((cell) => isNumericLike(cell))

	return firstLooksLabelLike && secondLooksDataLike
}

const detectDelimiterSeparated = (value: string):
	| {
			delimiter: string
			rows: string[][]
			hasHeader: boolean
	}
	| null => {
	const lines = normalizeLines(value)
	if (lines.length < 2) {
		return null
	}

	let best:
		| {
				delimiter: string
				rows: string[][]
				score: number
			}
		| null = null

	for (const delimiter of DELIMITER_CANDIDATES) {
		const rows = parseDelimiterSeparated(value, delimiter)
		if (rows.length < 2) {
			continue
		}

		const counts = rows.map((row) => row.length)
		const frequencies = new Map<number, number>()
		for (const count of counts) {
			frequencies.set(count, (frequencies.get(count) ?? 0) + 1)
		}

		const [mostFrequentColumns, consistency] = Array.from(
			frequencies.entries(),
		).sort((left, right) => right[1] - left[1])[0]

		if (!mostFrequentColumns || mostFrequentColumns < 2 || consistency < 2) {
			continue
		}

		const score = mostFrequentColumns * consistency
		if (!best || score > best.score) {
			best = {
				delimiter,
				rows,
				score,
			}
		}
	}

	if (!best) {
		return null
	}

	return {
		delimiter: best.delimiter,
		rows: best.rows,
		hasHeader: guessHasHeaderRow(best.rows),
	}
}

export const parseJsonValue = (
	value: string,
): { value?: unknown; error?: string } => {
	try {
		return {
			value: JSON.parse(value),
		}
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : 'Invalid JSON value.',
		}
	}
}

const INDENT = '  '

const createSegment = (
	text: string,
	kind: JsonTokenKind,
): JsonTokenSegment => ({
	text,
	kind,
})

const formatJsonLine = (
	indentLevel: number,
	segments: JsonTokenSegment[],
): JsonTokenLine => {
	const indent = INDENT.repeat(indentLevel)
	if (indent.length === 0) {
		return segments
	}

	return [createSegment(indent, 'punctuation'), ...segments]
}

const formatJsonTokenValue = (
	value: unknown,
	indentLevel: number,
): JsonTokenLine[] => {
	if (value === null) {
		return [[createSegment('null', 'null')]]
	}

	if (typeof value === 'string') {
		return [[createSegment(JSON.stringify(value), 'string')]]
	}

	if (typeof value === 'number') {
		return [[createSegment(String(value), 'number')]]
	}

	if (typeof value === 'boolean') {
		return [[createSegment(String(value), 'boolean')]]
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return [[createSegment('[]', 'punctuation')]]
		}

		const lines: JsonTokenLine[] = [[createSegment('[', 'punctuation')]]
		value.forEach((entry, index) => {
			const entryLines = formatJsonTokenValue(entry, indentLevel + 1)
			const isLastEntry = index === value.length - 1
			lines.push(formatJsonLine(indentLevel + 1, entryLines[0]))
			entryLines.slice(1).forEach((line) => {
				lines.push(line)
			})
			if (!isLastEntry) {
				const lastLine = lines[lines.length - 1]
				lastLine.push(createSegment(',', 'punctuation'))
			}
		})
		lines.push(formatJsonLine(indentLevel, [createSegment(']', 'punctuation')]))
		return lines
	}

	if (typeof value === 'object') {
		const entries = Object.entries(value)
		if (entries.length === 0) {
			return [[createSegment('{}', 'punctuation')]]
		}

		const lines: JsonTokenLine[] = [[createSegment('{', 'punctuation')]]
		entries.forEach(([key, entryValue], index) => {
			const entryLines = formatJsonTokenValue(entryValue, indentLevel + 1)
			const isLastEntry = index === entries.length - 1
			lines.push(
				formatJsonLine(indentLevel + 1, [
					createSegment(`${JSON.stringify(key)}: `, 'key'),
					...entryLines[0],
				]),
			)
			entryLines.slice(1).forEach((line) => {
				lines.push(line)
			})
			if (!isLastEntry) {
				const lastLine = lines[lines.length - 1]
				lastLine.push(createSegment(',', 'punctuation'))
			}
		})
		lines.push(formatJsonLine(indentLevel, [createSegment('}', 'punctuation')]))
		return lines
	}

	return [[createSegment(JSON.stringify(value), 'string')]]
}

export const formatJsonForHighlight = (value: unknown): JsonTokenLine[] =>
	formatJsonTokenValue(value, 0)

type JsonTokenizerContext = {
	kind: 'object' | 'array'
	expectKey: boolean
}

const isDigit = (value: string): boolean => value >= '0' && value <= '9'

const readJsonString = (value: string, startIndex: number): number => {
	let index = startIndex + 1
	let escaped = false

	while (index < value.length) {
		const character = value[index]
		if (character === '\n') {
			return index
		}

		if (escaped) {
			escaped = false
			index += 1
			continue
		}

		if (character === '\\') {
			escaped = true
			index += 1
			continue
		}

		if (character === '"') {
			return index + 1
		}

		index += 1
	}

	return index
}

const readJsonNumber = (value: string, startIndex: number): number | null => {
	const match = value.slice(startIndex).match(
		/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
	)
	return match ? startIndex + match[0].length : null
}

const readJsonLiteral = (value: string, startIndex: number): number | null => {
	for (const literal of ['true', 'false', 'null']) {
		if (value.startsWith(literal, startIndex)) {
			return startIndex + literal.length
		}
	}

	return null
}

const pushToken = (
	lines: JsonTokenLine[],
	text: string,
	kind: JsonTokenKind,
): void => {
	if (text.length === 0) {
		return
	}

	lines[lines.length - 1].push({ text, kind })
}

const startNewLine = (lines: JsonTokenLine[]): void => {
	lines.push([])
}

export const tokenizeJsonForHighlight = (value: string): JsonTokenLine[] => {
	const lines: JsonTokenLine[] = [[]]
	const contexts: JsonTokenizerContext[] = []

	let index = 0
	while (index < value.length) {
		const character = value[index]

		if (character === '\r') {
			index += 1
			continue
		}

		if (character === '\n') {
			startNewLine(lines)
			index += 1
			continue
		}

		if (character === ' ' || character === '\t' || character === '\f') {
			const start = index
			while (
				index < value.length &&
				(value[index] === ' ' || value[index] === '\t' || value[index] === '\f')
			) {
				index += 1
			}
			pushToken(lines, value.slice(start, index), 'punctuation')
			continue
		}

		if (character === '{') {
			pushToken(lines, character, 'punctuation')
			contexts.push({ kind: 'object', expectKey: true })
			index += 1
			continue
		}

		if (character === '}') {
			pushToken(lines, character, 'punctuation')
			contexts.pop()
			index += 1
			continue
		}

		if (character === '[') {
			pushToken(lines, character, 'punctuation')
			contexts.push({ kind: 'array', expectKey: false })
			index += 1
			continue
		}

		if (character === ']') {
			pushToken(lines, character, 'punctuation')
			contexts.pop()
			index += 1
			continue
		}

		if (character === ':') {
			pushToken(lines, character, 'punctuation')
			index += 1
			continue
		}

		if (character === ',') {
			pushToken(lines, character, 'punctuation')
			const currentContext = contexts[contexts.length - 1]
			if (currentContext?.kind === 'object') {
				currentContext.expectKey = true
			}
			index += 1
			continue
		}

		if (character === '"') {
			const endIndex = readJsonString(value, index)
			const tokenText = value.slice(index, endIndex)
			const currentContext = contexts[contexts.length - 1]
			const tokenKind =
				currentContext?.kind === 'object' && currentContext.expectKey
					? 'key'
					: 'string'

			pushToken(lines, tokenText, tokenKind)
			if (currentContext?.kind === 'object' && currentContext.expectKey) {
				currentContext.expectKey = false
			}
			index = endIndex
			continue
		}

		if (character === '-' || isDigit(character)) {
			const endIndex = readJsonNumber(value, index)
			if (endIndex !== null) {
				pushToken(lines, value.slice(index, endIndex), 'number')
				index = endIndex
				continue
			}
		}

		const literalEndIndex = readJsonLiteral(value, index)
		if (literalEndIndex !== null) {
			const literalText = value.slice(index, literalEndIndex)
			const tokenKind =
				literalText === 'true' || literalText === 'false'
					? 'boolean'
					: 'null'
			pushToken(lines, literalText, tokenKind)
			index = literalEndIndex
			continue
		}

		pushToken(lines, character, 'punctuation')
		index += 1
	}

	return lines
}

export const detectValueStructure = (value: string): VisualizerDetection => {
	const trimmed = value.trim()
	if (!trimmed) {
		return {
			type: 'raw',
		}
	}

	const parsedJson = parseJsonValue(value)
	const jsonValue = parsedJson.value
	const isStructuredJson =
		Array.isArray(jsonValue) ||
		(typeof jsonValue === 'object' && jsonValue !== null)
	if (isStructuredJson) {
		return {
			type: 'json',
			value: jsonValue,
		}
	}

	const dsv = detectDelimiterSeparated(value)
	if (dsv) {
		return {
			type: 'dsv',
			delimiter: dsv.delimiter,
			rows: dsv.rows,
			hasHeader: dsv.hasHeader,
		}
	}

	return {
		type: 'raw',
	}
}
