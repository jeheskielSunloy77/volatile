import * as React from 'react'

import { Badge } from '@/renderer/components/ui/badge'
import { Checkbox } from '@/renderer/components/ui/checkbox'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/renderer/components/ui/table'
import {
	detectValueStructure,
	normalizeDelimiter,
	parseDelimiterSeparated,
	parseJsonValue,
	type VisualizerDataType,
} from '@/renderer/features/workspace/key-value-visualizer-utils'

type VisualizerMode = 'auto' | VisualizerDataType
type JsonRenderMode = 'structured' | 'pretty'

type KeyValueVisualizerProps = {
	keyId: string | null
	value: string | null
}

const formatPrimitive = (value: unknown): string => {
	if (value === null) {
		return 'null'
	}

	if (typeof value === 'string') {
		return value
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value)
	}

	return JSON.stringify(value)
}

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const JsonTreeNode = ({
	label,
	value,
	depth,
}: {
	label: string
	value: unknown
	depth: number
}) => {
	if (Array.isArray(value)) {
		return (
			<details open={depth < 1} className='space-y-1'>
				<summary className='cursor-pointer select-none text-xs'>
					<span className='font-medium'>{label}</span> <Badge variant='outline'>array[{value.length}]</Badge>
				</summary>
				<div className='border-border ml-2 space-y-1 border-l pl-2'>
					{value.map((entry, index) => (
						<JsonTreeNode
							key={`${label}-${index}`}
							label={String(index)}
							value={entry}
							depth={depth + 1}
						/>
					))}
				</div>
			</details>
		)
	}

	if (isObjectLike(value)) {
		const entries = Object.entries(value)
		return (
			<details open={depth < 1} className='space-y-1'>
				<summary className='cursor-pointer select-none text-xs'>
					<span className='font-medium'>{label}</span> <Badge variant='outline'>object</Badge>
				</summary>
				<div className='border-border ml-2 space-y-1 border-l pl-2'>
					{entries.map(([key, entryValue]) => (
						<JsonTreeNode
							key={`${label}-${key}`}
							label={key}
							value={entryValue}
							depth={depth + 1}
						/>
					))}
				</div>
			</details>
		)
	}

	return (
		<div className='flex items-center gap-2 text-xs'>
			<span className='font-medium'>{label}</span>
			<Badge variant='outline'>{value === null ? 'null' : typeof value}</Badge>
			<span className='text-muted-foreground break-all'>{formatPrimitive(value)}</span>
		</div>
	)
}

export const KeyValueVisualizer = ({ keyId, value }: KeyValueVisualizerProps) => {
	const rawValue = value ?? ''
	const detection = React.useMemo(() => detectValueStructure(rawValue), [rawValue])
	const [mode, setMode] = React.useState<VisualizerMode>('auto')
	const [jsonRenderMode, setJsonRenderMode] =
		React.useState<JsonRenderMode>('pretty')
	const [delimiterInput, setDelimiterInput] = React.useState(',')
	const [hasHeader, setHasHeader] = React.useState(false)

	React.useEffect(() => {
		setMode('auto')
		if (detection.type === 'dsv') {
			setDelimiterInput(detection.delimiter === '\t' ? '\\t' : detection.delimiter)
			setHasHeader(detection.hasHeader)
			return
		}

		setDelimiterInput(',')
		setHasHeader(false)
		setJsonRenderMode('pretty')
	}, [keyId, rawValue, detection])

	const activeType: VisualizerDataType =
		mode === 'auto' ? detection.type : mode
	const autoModeLabel =
		detection.type === 'json'
			? 'Auto (JSON)'
			: detection.type === 'dsv'
				? 'Auto (Delimiter-separated)'
				: 'Auto (Raw)'
	const jsonParsed = React.useMemo(() => parseJsonValue(rawValue), [rawValue])
	const delimiter = normalizeDelimiter(delimiterInput)
	const rows = React.useMemo(
		() => parseDelimiterSeparated(rawValue, delimiter),
		[rawValue, delimiter],
	)

	const maxColumnCount = rows.reduce(
		(currentMax, row) => Math.max(currentMax, row.length),
		0,
	)
	const generatedHeaders = Array.from({ length: maxColumnCount }, (_, index) =>
		`col${index + 1}`,
	)
	const headers = generatedHeaders.map((fallback, index) =>
		hasHeader && rows.length > 0 ? rows[0][index] || fallback : fallback,
	)
	const dataRows = hasHeader ? rows.slice(1) : rows
	const visualizerModeLabel =
		mode === 'auto'
			? autoModeLabel
			: mode === 'raw'
				? 'Raw'
				: mode === 'json'
					? 'JSON'
					: 'Delimiter-separated'
	const jsonViewLabel =
		jsonRenderMode === 'structured' ? 'Structured' : 'Pretty JSON'

	return (
		<div className='border-border flex h-full min-h-0 flex-col gap-3 border p-2'>
			<div className='flex flex-wrap items-center gap-2 text-xs'>
				<label className='flex items-center gap-1'>
					<span className='text-muted-foreground'>View</span>
					<Select
						value={mode}
						onValueChange={(value) => setMode(value as VisualizerMode)}
					>
						<SelectTrigger className='w-44'>
							<SelectValue>{visualizerModeLabel}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='auto'>{autoModeLabel}</SelectItem>
							<SelectItem value='raw'>Raw</SelectItem>
							<SelectItem value='json'>JSON</SelectItem>
							<SelectItem value='dsv'>Delimiter-separated</SelectItem>
						</SelectContent>
					</Select>
				</label>
				{(activeType === 'json' || mode === 'json') && (
					<label className='flex items-center gap-1'>
						<span className='text-muted-foreground'>JSON view</span>
						<Select
							value={jsonRenderMode}
							onValueChange={(value) => setJsonRenderMode(value as JsonRenderMode)}
						>
							<SelectTrigger className='w-36'>
								<SelectValue>{jsonViewLabel}</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='structured'>Structured</SelectItem>
								<SelectItem value='pretty'>Pretty JSON</SelectItem>
							</SelectContent>
						</Select>
					</label>
				)}
				{(activeType === 'dsv' || mode === 'dsv') && (
					<>
						<label className='flex items-center gap-1'>
							<span className='text-muted-foreground'>Delimiter</span>
							<input
								value={delimiterInput}
								onChange={(event) => setDelimiterInput(event.target.value)}
								className='border-input dark:bg-input/30 h-8 w-16 rounded-none border bg-transparent px-2 text-xs'
								placeholder=','
							/>
						</label>
						<label className='flex items-center gap-2'>
							<Checkbox
								checked={hasHeader}
								onCheckedChange={(checked) => setHasHeader(Boolean(checked))}
							/>
							<span>Header row</span>
						</label>
					</>
				)}
			</div>

			<div className='min-h-0 flex-1 overflow-auto'>
				{activeType === 'raw' && (
					<pre className='bg-muted/40 h-full whitespace-pre-wrap break-all rounded-none p-2 text-xs'>
						{rawValue || '(empty)'}
					</pre>
				)}

				{activeType === 'json' && (
					jsonParsed.error ? (
						<div className='space-y-2 text-xs'>
							<p className='text-destructive'>Unable to parse JSON: {jsonParsed.error}</p>
							<pre className='bg-muted/40 whitespace-pre-wrap break-all rounded-none p-2'>
								{rawValue || '(empty)'}
							</pre>
						</div>
					) : jsonRenderMode === 'pretty' ? (
						<pre className='bg-muted/40 whitespace-pre-wrap break-all rounded-none p-2 text-xs'>
							{JSON.stringify(jsonParsed.value, null, 2)}
						</pre>
					) : (
						<div className='space-y-1'>
							<JsonTreeNode label='root' value={jsonParsed.value} depth={0} />
						</div>
					)
				)}

				{activeType === 'dsv' && (
					rows.length === 0 || maxColumnCount < 2 ? (
						<div className='text-muted-foreground text-xs'>
							No delimiter-separated rows detected.
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									{headers.map((header, index) => (
										<TableHead key={`${header}-${index}`}>{header}</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{dataRows.map((row, rowIndex) => (
									<TableRow key={`row-${rowIndex}`}>
										{generatedHeaders.map((column, colIndex) => (
											<TableCell key={`${column}-${colIndex}`}>
												{row[colIndex] ?? ''}
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					)
				)}
			</div>
		</div>
	)
}
