import * as React from 'react'

import { cn } from '@/renderer/lib/utils'
import {
  tokenizeJsonForHighlight,
  type JsonTokenKind,
} from '@/renderer/features/workspace/key-value-visualizer-utils'

const JSON_TOKEN_CLASS_NAMES: Record<JsonTokenKind, string> = {
  punctuation: 'json-token-punctuation',
  key: 'json-token-key',
  string: 'json-token-string',
  number: 'json-token-number',
  boolean: 'json-token-boolean',
  null: 'json-token-null',
}

type JsonEditorProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  minHeightClassName?: string
  highlight?: boolean
}

export const JsonEditor = ({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  minHeightClassName = 'min-h-56',
  highlight = true,
}: JsonEditorProps) => {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = React.useRef<HTMLPreElement | null>(null)

  const highlightedLines = React.useMemo(() => {
    if (!highlight) {
      return null
    }

    return tokenizeJsonForHighlight(value)
  }, [highlight, value])

  const syncScroll = React.useCallback(() => {
    if (!textareaRef.current || !highlightRef.current) {
      return
    }

    highlightRef.current.scrollTop = textareaRef.current.scrollTop
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
  }, [])

  return (
    <div
      className={cn(
        'border-input dark:bg-input/30 relative overflow-hidden rounded-none border',
        minHeightClassName,
        className,
      )}
    >
      <pre
        ref={highlightRef}
        aria-hidden='true'
        className={cn(
          'pointer-events-none absolute inset-0 z-0 overflow-auto px-2.5 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words',
          highlightedLines ? '' : 'text-foreground',
        )}
      >
        {highlightedLines
          ? highlightedLines.map((line, lineIndex) => (
              <React.Fragment key={`line-${lineIndex}`}>
                {line.map((segment, segmentIndex) => (
                  <span
                    key={`segment-${lineIndex}-${segmentIndex}`}
                    className={JSON_TOKEN_CLASS_NAMES[segment.kind]}
                  >
                    {segment.text}
                  </span>
                ))}
                {lineIndex < highlightedLines.length - 1 ? '\n' : null}
              </React.Fragment>
            ))
          : value}
        {value.length === 0 ? ' ' : null}
      </pre>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          'caret-foreground placeholder:text-muted-foreground absolute inset-0 z-10 resize-none overflow-auto bg-transparent px-2.5 py-2 font-mono text-xs leading-5 outline-none',
          highlightedLines
            ? 'text-transparent selection:bg-accent selection:text-transparent'
            : 'text-foreground',
          disabled ? 'cursor-not-allowed opacity-60' : '',
        )}
      />
    </div>
  )
}
