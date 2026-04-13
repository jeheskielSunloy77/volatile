import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Clock3Icon,
  KeyRoundIcon,
  PlusIcon,
  SaveIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/renderer/components/ui/dialog";
import { Input } from "@/renderer/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@/renderer/components/ui/input-group";
import { Label } from "@/renderer/components/ui/label";
import { LoadingSkeletonLines } from "@/renderer/components/ui/loading-skeleton";
import { JsonEditor } from "@/renderer/components/ui/json-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/renderer/components/ui/select";
import type {
  KeySetRequest,
  KeyValueRecord,
  RedisKeyType,
} from "@/shared/contracts/cache";

type EditableRedisKeyKind = Exclude<RedisKeyType, "none" | "unknown">;

type HashEntry = { field: string; value: string };
type ZsetEntry = { member: string; score: string };
type StreamFieldEntry = { field: string; value: string };
type StreamEntry = { fields: StreamFieldEntry[] };

export type KeyEditorDraft = {
  kind: EditableRedisKeyKind;
  stringValue: string;
  hashEntries: HashEntry[];
  listItems: string[];
  setMembers: string[];
  zsetEntries: ZsetEntry[];
  streamEntries: StreamEntry[];
};

export type KeyEditorMode = "structured" | "json";

const EDITABLE_KEY_TYPES: EditableRedisKeyKind[] = [
  "string",
  "hash",
  "list",
  "set",
  "zset",
  "stream",
];

const isEditableRedisKeyKind = (
  value: RedisKeyType | undefined,
): value is EditableRedisKeyKind =>
  typeof value === "string" &&
  EDITABLE_KEY_TYPES.includes(value as EditableRedisKeyKind);

const EMPTY_HASH_ENTRY: HashEntry = { field: "", value: "" };
const EMPTY_STREAM_FIELD: StreamFieldEntry = { field: "", value: "" };
const EMPTY_STREAM_ENTRY: StreamEntry = { fields: [{ ...EMPTY_STREAM_FIELD }] };

const toText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

const parseJsonValue = (value: string | null): unknown => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const createEmptyKeyEditorDraft = (
  kind: EditableRedisKeyKind = "string",
): KeyEditorDraft => ({
  kind,
  stringValue: "",
  hashEntries: [{ ...EMPTY_HASH_ENTRY }],
  listItems: [""],
  setMembers: [""],
  zsetEntries: [{ member: "", score: "0" }],
  streamEntries: [{ fields: [{ ...EMPTY_STREAM_FIELD }] }],
});

export const createKeyEditorDraftFromRecord = (
  record: Pick<KeyValueRecord, "keyType" | "value"> | undefined,
  fallbackKind: EditableRedisKeyKind = "string",
): KeyEditorDraft => {
  const kind = isEditableRedisKeyKind(record?.keyType)
    ? record.keyType
    : fallbackKind;
  const base = createEmptyKeyEditorDraft(kind);
  const parsed = parseJsonValue(record?.value ?? null);

  switch (kind) {
    case "string":
      return {
        ...base,
        stringValue: record?.value ?? "",
      };
    case "hash":
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed).map(([field, value]) => ({
          field,
          value: toText(value),
        }));
        return {
          ...base,
          hashEntries: entries.length > 0 ? entries : base.hashEntries,
        };
      }
      return base;
    case "list":
      if (Array.isArray(parsed)) {
        const items = parsed.map((item) => toText(item));
        return {
          ...base,
          listItems: items.length > 0 ? items : base.listItems,
        };
      }
      return base;
    case "set":
      if (Array.isArray(parsed)) {
        const members = parsed.map((item) => toText(item));
        return {
          ...base,
          setMembers: members.length > 0 ? members : base.setMembers,
        };
      }
      return base;
    case "zset":
      if (Array.isArray(parsed)) {
        const entries = parsed.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return [];
          }

          const member = "member" in item ? toText(item.member) : "";
          const score = "score" in item ? String(item.score ?? "") : "";
          return [{ member, score }];
        });
        return {
          ...base,
          zsetEntries: entries.length > 0 ? entries : base.zsetEntries,
        };
      }
      return base;
    case "stream":
      if (Array.isArray(parsed)) {
        const entries = parsed.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return [];
          }

          const rawFields =
            "fields" in item && item.fields && typeof item.fields === "object"
              ? Object.entries(item.fields as Record<string, unknown>).map(
                  ([field, value]) => ({ field, value: toText(value) }),
                )
              : [];
          return [
            {
              fields:
                rawFields.length > 0 ? rawFields : [{ ...EMPTY_STREAM_FIELD }],
            },
          ];
        });
        return {
          ...base,
          streamEntries: entries.length > 0 ? entries : base.streamEntries,
        };
      }
      return base;
  }
};

export const serializeKeyEditorDraft = (
  draft: KeyEditorDraft,
): KeySetRequest["value"] => {
  switch (draft.kind) {
    case "string":
      return {
        kind: "string",
        value: draft.stringValue,
      };
    case "hash":
      return {
        kind: "hash",
        entries: draft.hashEntries.map((entry) => ({
          field: entry.field.trim(),
          value: entry.value,
        })),
      };
    case "list":
      return {
        kind: "list",
        items: draft.listItems,
      };
    case "set":
      return {
        kind: "set",
        members: draft.setMembers.map((member) => member.trim()),
      };
    case "zset":
      return {
        kind: "zset",
        entries: draft.zsetEntries.map((entry) => ({
          member: entry.member,
          score: Number(entry.score),
        })),
      };
    case "stream":
      return {
        kind: "stream",
        entries: draft.streamEntries.map((entry) => ({
          fields: entry.fields.map((field) => ({
            field: field.field.trim(),
            value: field.value,
          })),
        })),
      };
  }
};

export const serializeKeyEditorDraftToJson = (
  draft: KeyEditorDraft,
): string => {
  switch (draft.kind) {
    case "string":
      return draft.stringValue;
    case "hash":
      return JSON.stringify(
        Object.fromEntries(
          draft.hashEntries.map((entry) => [entry.field.trim(), entry.value]),
        ),
        null,
        2,
      );
    case "list":
      return JSON.stringify(draft.listItems, null, 2);
    case "set":
      return JSON.stringify(
        draft.setMembers.map((member) => member.trim()),
        null,
        2,
      );
    case "zset":
      return JSON.stringify(
        draft.zsetEntries.map((entry) => ({
          member: entry.member,
          score: Number(entry.score),
        })),
        null,
        2,
      );
    case "stream":
      return JSON.stringify(
        draft.streamEntries.map((entry) => ({
          fields: Object.fromEntries(
            entry.fields.map((field) => [field.field.trim(), field.value]),
          ),
        })),
        null,
        2,
      );
  }
};

export const parseKeyEditorDraftFromJson = (
  kind: EditableRedisKeyKind,
  raw: string,
): KeyEditorDraft => {
  if (kind === "string") {
    return {
      ...createEmptyKeyEditorDraft("string"),
      stringValue: raw,
    };
  }

  const parsed = JSON.parse(raw);

  switch (kind) {
    case "hash": {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Hash JSON must be an object.");
      }
      return {
        ...createEmptyKeyEditorDraft("hash"),
        hashEntries: Object.entries(parsed).map(([field, value]) => ({
          field,
          value: toText(value),
        })),
      };
    }
    case "list": {
      if (!Array.isArray(parsed)) {
        throw new Error("List JSON must be an array.");
      }
      return {
        ...createEmptyKeyEditorDraft("list"),
        listItems: parsed.map((item) => toText(item)),
      };
    }
    case "set": {
      if (!Array.isArray(parsed)) {
        throw new Error("Set JSON must be an array.");
      }
      return {
        ...createEmptyKeyEditorDraft("set"),
        setMembers: parsed.map((item) => toText(item)),
      };
    }
    case "zset": {
      if (!Array.isArray(parsed)) {
        throw new Error("Sorted set JSON must be an array.");
      }
      return {
        ...createEmptyKeyEditorDraft("zset"),
        zsetEntries: parsed.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error("Each sorted set entry must be an object.");
          }
          return {
            member: "member" in item ? toText(item.member) : "",
            score: "score" in item ? String(item.score ?? "") : "",
          };
        }),
      };
    }
    case "stream": {
      if (!Array.isArray(parsed)) {
        throw new Error("Stream JSON must be an array.");
      }
      return {
        ...createEmptyKeyEditorDraft("stream"),
        streamEntries: parsed.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error("Each stream entry must be an object.");
          }
          const fields =
            "fields" in item &&
            item.fields &&
            typeof item.fields === "object" &&
            !Array.isArray(item.fields)
              ? Object.entries(item.fields as Record<string, unknown>).map(
                  ([field, value]) => ({ field, value: toText(value) }),
                )
              : null;
          if (!fields) {
            throw new Error("Each stream entry must include a fields object.");
          }
          return { fields };
        }),
      };
    }
    case "string":
      return createEmptyKeyEditorDraft("string");
  }
};

export const validateRawJsonForDraftKind = (
  kind: EditableRedisKeyKind,
  raw: string,
): string | null => {
  try {
    const draft = parseKeyEditorDraftFromJson(kind, raw);
    return validateKeyEditorDraft(draft);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid raw JSON.";
  }
};

export const validateKeyEditorDraft = (
  draft: KeyEditorDraft,
): string | null => {
  switch (draft.kind) {
    case "string":
      return null;
    case "hash": {
      const seen = new Set<string>();
      for (const entry of draft.hashEntries) {
        const field = entry.field.trim();
        if (!field) {
          return "Hash fields cannot be empty.";
        }
        if (seen.has(field)) {
          return `Duplicate hash field "${field}".`;
        }
        seen.add(field);
      }
      return null;
    }
    case "list":
      return null;
    case "set": {
      const seen = new Set<string>();
      for (const member of draft.setMembers) {
        const normalized = member.trim();
        if (!normalized) {
          return "Set members cannot be empty.";
        }
        if (seen.has(normalized)) {
          return `Duplicate set member "${normalized}".`;
        }
        seen.add(normalized);
      }
      return null;
    }
    case "zset": {
      const seen = new Set<string>();
      for (const entry of draft.zsetEntries) {
        if (!entry.member) {
          return "Sorted set members cannot be empty.";
        }
        if (!Number.isFinite(Number(entry.score))) {
          return `Invalid score for member "${entry.member || "entry"}".`;
        }
        if (seen.has(entry.member)) {
          return `Duplicate sorted set member "${entry.member}".`;
        }
        seen.add(entry.member);
      }
      return null;
    }
    case "stream":
      for (const [entryIndex, entry] of draft.streamEntries.entries()) {
        if (entry.fields.length === 0) {
          return `Stream entry ${entryIndex + 1} must include at least one field.`;
        }
        const seen = new Set<string>();
        for (const field of entry.fields) {
          const normalized = field.field.trim();
          if (!normalized) {
            return `Stream entry ${entryIndex + 1} has an empty field name.`;
          }
          if (seen.has(normalized)) {
            return `Stream entry ${entryIndex + 1} has duplicate field "${normalized}".`;
          }
          seen.add(normalized);
        }
      }
      return null;
  }
};

type KeyUpsertDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  readOnly: boolean;
  supportsTTL: boolean;
  isRedisConnection: boolean;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage?: string;
  validationMessage?: string | null;
  isRetryableError?: boolean;
  keyName: string;
  draft: KeyEditorDraft;
  editorMode: KeyEditorMode;
  rawJsonValue: string;
  ttlSeconds: string;
  onOpenChange: (open: boolean) => void;
  onKeyNameChange: (value: string) => void;
  onDraftChange: (draft: KeyEditorDraft) => void;
  onEditorModeChange: (mode: KeyEditorMode) => void;
  onRawJsonValueChange: (value: string) => void;
  onTtlChange: (value: string) => void;
  onRetry?: () => void;
  onSave: () => void;
};

const getTypeLabel = (kind: EditableRedisKeyKind): string => {
  switch (kind) {
    case "string":
      return "String";
    case "hash":
      return "Hash";
    case "list":
      return "List";
    case "set":
      return "Set";
    case "zset":
      return "Sorted Set";
    case "stream":
      return "Stream";
  }
};

const RowActions = ({
  disabled,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  disabled?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) => (
  <div className="flex items-center gap-1">
    {onMoveUp && (
      <Button
        variant="outline"
        size="icon-sm"
        disabled={disabled}
        onClick={onMoveUp}
      >
        <ArrowUpIcon className="size-3.5" />
      </Button>
    )}
    {onMoveDown && (
      <Button
        variant="outline"
        size="icon-sm"
        disabled={disabled}
        onClick={onMoveDown}
      >
        <ArrowDownIcon className="size-3.5" />
      </Button>
    )}
    <Button
      variant="outline"
      size="icon-sm"
      disabled={disabled}
      onClick={onRemove}
    >
      <Trash2Icon className="size-3.5" />
    </Button>
  </div>
);

const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (toIndex < 0 || toIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const renderListRows = (
  items: string[],
  disabled: boolean,
  onChange: (items: string[]) => void,
) => (
  <div className="space-y-2">
    {items.map((item, index) => (
      <div key={`${index}-${item}`} className="flex items-center gap-2">
        <Input
          value={item}
          disabled={disabled}
          placeholder="Value"
          onChange={(event) => {
            const next = [...items];
            next[index] = event.target.value;
            onChange(next);
          }}
        />
        <RowActions
          disabled={disabled}
          onMoveUp={
            index > 0
              ? () => onChange(moveItem(items, index, index - 1))
              : undefined
          }
          onMoveDown={
            index < items.length - 1
              ? () => onChange(moveItem(items, index, index + 1))
              : undefined
          }
          onRemove={() =>
            onChange(
              items.length === 1
                ? [""]
                : items.filter((_, itemIndex) => itemIndex !== index),
            )
          }
        />
      </div>
    ))}
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => onChange([...items, ""])}
    >
      <PlusIcon className="size-3.5" />
      Add Row
    </Button>
  </div>
);

export const KeyUpsertDialog = ({
  open,
  mode,
  readOnly,
  supportsTTL,
  isRedisConnection,
  isLoading,
  isSaving,
  errorMessage,
  validationMessage,
  isRetryableError,
  keyName,
  draft,
  editorMode,
  rawJsonValue,
  ttlSeconds,
  onOpenChange,
  onKeyNameChange,
  onDraftChange,
  onEditorModeChange,
  onRawJsonValueChange,
  onTtlChange,
  onRetry,
  onSave,
}: KeyUpsertDialogProps) => {
  const isEditMode = mode === "edit";
  const activeKind = draft.kind;
  const disabled = readOnly || isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0">
        <div className="flex flex-col">
          <div className="border-b p-4">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <DialogTitle>
                    {isEditMode ? "Edit Key" : "Create Key"}
                  </DialogTitle>
                  <DialogDescription>
                    {isEditMode
                      ? `Update ${getTypeLabel(activeKind).toLowerCase()} data and TTL.`
                      : "Create a new key with a type-specific editor and optional TTL."}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  {readOnly && <Badge variant="outline">Read-only</Badge>}
                  <Badge variant="outline">
                    Type: {getTypeLabel(activeKind)}
                  </Badge>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="space-y-3 rounded-none border p-3">
                <LoadingSkeletonLines
                  count={4}
                  widths={["w-1/3", "w-2/3", "w-1/2", "w-3/5"]}
                />
              </div>
            ) : errorMessage ? (
              <div className="space-y-2 border p-2 text-xs">
                <p className="text-destructive">{errorMessage}</p>
                {isRetryableError && onRetry && (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Editor Mode</p>
                    <p className="text-muted-foreground text-xs">
                      Switch between structured controls and a raw JSON editor.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={
                        editorMode === "structured" ? "default" : "outline"
                      }
                      size="sm"
                      disabled={readOnly}
                      onClick={() => onEditorModeChange("structured")}
                    >
                      Structured
                    </Button>
                    <Button
                      variant={editorMode === "json" ? "default" : "outline"}
                      size="sm"
                      disabled={readOnly}
                      onClick={() => onEditorModeChange("json")}
                    >
                      Raw JSON
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="workspace-upsert-key">Key</Label>
                    <InputGroup>
                      <InputGroupAddon>
                        <KeyRoundIcon className="size-3.5" />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="workspace-upsert-key"
                        value={keyName}
                        onChange={(event) =>
                          onKeyNameChange(event.target.value)
                        }
                        placeholder="session:123"
                        disabled={readOnly}
                      />
                    </InputGroup>
                  </div>

                  {isRedisConnection ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-upsert-type">Key Type</Label>
                      <Select
                        value={draft.kind}
                        onValueChange={(value) =>
                          onDraftChange(
                            createEmptyKeyEditorDraft(
                              value as EditableRedisKeyKind,
                            ),
                          )
                        }
                      >
                        <SelectTrigger
                          id="workspace-upsert-type"
                          className="w-full"
                          disabled={readOnly}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EDITABLE_KEY_TYPES.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {getTypeLabel(kind)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-upsert-type-static">
                        Key Type
                      </Label>
                      <Input
                        id="workspace-upsert-type-static"
                        value={getTypeLabel(activeKind)}
                        disabled
                      />
                    </div>
                  )}
                </div>

                {editorMode === "json" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="workspace-upsert-raw-json">Raw JSON</Label>
                    <JsonEditor
                      id="workspace-upsert-raw-json"
                      value={rawJsonValue}
                      onChange={onRawJsonValueChange}
                      disabled={disabled}
                      highlight={activeKind !== "string"}
                      minHeightClassName="min-h-[50vh]"
                      placeholder={
                        activeKind === "string"
                          ? "Raw string content"
                          : "Enter the canonical JSON shape for this key type"
                      }
                    />
                  </div>
                ) : (
                  activeKind === "string" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="workspace-upsert-value">Value</Label>
                      <InputGroup className="min-h-44 items-start">
                        <InputGroupAddon className="pt-2">
                          <TextCursorInputIcon className="size-3.5" />
                        </InputGroupAddon>
                        <InputGroupTextarea
                          id="workspace-upsert-value"
                          value={draft.stringValue}
                          onChange={(event) =>
                            onDraftChange({
                              ...draft,
                              stringValue: event.target.value,
                            })
                          }
                          className="min-h-44"
                          placeholder="JSON or string value"
                          disabled={disabled}
                        />
                      </InputGroup>
                    </div>
                  )
                )}

                {editorMode === "structured" && activeKind === "hash" && (
                  <div className="space-y-2">
                    <Label>Fields</Label>
                    <div className="space-y-2">
                      {draft.hashEntries.map((entry, index) => (
                        <div
                          key={`${index}-${entry.field}`}
                          className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                        >
                          <Input
                            value={entry.field}
                            disabled={disabled}
                            placeholder="Field"
                            onChange={(event) => {
                              const next = [...draft.hashEntries];
                              next[index] = {
                                ...entry,
                                field: event.target.value,
                              };
                              onDraftChange({ ...draft, hashEntries: next });
                            }}
                          />
                          <Input
                            value={entry.value}
                            disabled={disabled}
                            placeholder="Value"
                            onChange={(event) => {
                              const next = [...draft.hashEntries];
                              next[index] = {
                                ...entry,
                                value: event.target.value,
                              };
                              onDraftChange({ ...draft, hashEntries: next });
                            }}
                          />
                          <RowActions
                            disabled={disabled}
                            onRemove={() =>
                              onDraftChange({
                                ...draft,
                                hashEntries:
                                  draft.hashEntries.length === 1
                                    ? [{ ...EMPTY_HASH_ENTRY }]
                                    : draft.hashEntries.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          hashEntries: [
                            ...draft.hashEntries,
                            { ...EMPTY_HASH_ENTRY },
                          ],
                        })
                      }
                    >
                      <PlusIcon className="size-3.5" />
                      Add Field
                    </Button>
                  </div>
                )}

                {editorMode === "structured" && activeKind === "list" && (
                  <div className="space-y-1.5">
                    <Label>Items</Label>
                    {renderListRows(draft.listItems, disabled, (listItems) =>
                      onDraftChange({ ...draft, listItems }),
                    )}
                  </div>
                )}

                {editorMode === "structured" && activeKind === "set" && (
                  <div className="space-y-1.5">
                    <Label>Members</Label>
                    {renderListRows(draft.setMembers, disabled, (setMembers) =>
                      onDraftChange({ ...draft, setMembers }),
                    )}
                  </div>
                )}

                {editorMode === "structured" && activeKind === "zset" && (
                  <div className="space-y-2">
                    <Label>Members</Label>
                    <div className="space-y-2">
                      {draft.zsetEntries.map((entry, index) => (
                        <div
                          key={`${index}-${entry.member}`}
                          className="grid gap-2 md:grid-cols-[1fr_140px_auto]"
                        >
                          <Input
                            value={entry.member}
                            disabled={disabled}
                            placeholder="Member"
                            onChange={(event) => {
                              const next = [...draft.zsetEntries];
                              next[index] = {
                                ...entry,
                                member: event.target.value,
                              };
                              onDraftChange({ ...draft, zsetEntries: next });
                            }}
                          />
                          <Input
                            type="number"
                            step="any"
                            value={entry.score}
                            disabled={disabled}
                            placeholder="0"
                            onChange={(event) => {
                              const next = [...draft.zsetEntries];
                              next[index] = {
                                ...entry,
                                score: event.target.value,
                              };
                              onDraftChange({ ...draft, zsetEntries: next });
                            }}
                          />
                          <RowActions
                            disabled={disabled}
                            onRemove={() =>
                              onDraftChange({
                                ...draft,
                                zsetEntries:
                                  draft.zsetEntries.length === 1
                                    ? [{ member: "", score: "0" }]
                                    : draft.zsetEntries.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          zsetEntries: [
                            ...draft.zsetEntries,
                            { member: "", score: "0" },
                          ],
                        })
                      }
                    >
                      <PlusIcon className="size-3.5" />
                      Add Member
                    </Button>
                  </div>
                )}

                {editorMode === "structured" && activeKind === "stream" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>Entries</Label>
                      <p className="text-muted-foreground text-xs">
                        Saved stream entries are recreated with fresh
                        auto-generated IDs.
                      </p>
                    </div>
                    <div className="space-y-3">
                      {draft.streamEntries.map((entry, entryIndex) => (
                        <div key={entryIndex} className="space-y-2 border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium">
                              Entry {entryIndex + 1}
                            </p>
                            <RowActions
                              disabled={disabled}
                              onMoveUp={
                                entryIndex > 0
                                  ? () =>
                                      onDraftChange({
                                        ...draft,
                                        streamEntries: moveItem(
                                          draft.streamEntries,
                                          entryIndex,
                                          entryIndex - 1,
                                        ),
                                      })
                                  : undefined
                              }
                              onMoveDown={
                                entryIndex < draft.streamEntries.length - 1
                                  ? () =>
                                      onDraftChange({
                                        ...draft,
                                        streamEntries: moveItem(
                                          draft.streamEntries,
                                          entryIndex,
                                          entryIndex + 1,
                                        ),
                                      })
                                  : undefined
                              }
                              onRemove={() =>
                                onDraftChange({
                                  ...draft,
                                  streamEntries:
                                    draft.streamEntries.length === 1
                                      ? [
                                          {
                                            fields: [{ ...EMPTY_STREAM_FIELD }],
                                          },
                                        ]
                                      : draft.streamEntries.filter(
                                          (_, itemIndex) =>
                                            itemIndex !== entryIndex,
                                        ),
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            {entry.fields.map((field, fieldIndex) => (
                              <div
                                key={`${fieldIndex}-${field.field}`}
                                className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
                              >
                                <Input
                                  value={field.field}
                                  disabled={disabled}
                                  placeholder="Field"
                                  onChange={(event) => {
                                    const nextEntries = [
                                      ...draft.streamEntries,
                                    ];
                                    const nextFields = [...entry.fields];
                                    nextFields[fieldIndex] = {
                                      ...field,
                                      field: event.target.value,
                                    };
                                    nextEntries[entryIndex] = {
                                      ...entry,
                                      fields: nextFields,
                                    };
                                    onDraftChange({
                                      ...draft,
                                      streamEntries: nextEntries,
                                    });
                                  }}
                                />
                                <Input
                                  value={field.value}
                                  disabled={disabled}
                                  placeholder="Value"
                                  onChange={(event) => {
                                    const nextEntries = [
                                      ...draft.streamEntries,
                                    ];
                                    const nextFields = [...entry.fields];
                                    nextFields[fieldIndex] = {
                                      ...field,
                                      value: event.target.value,
                                    };
                                    nextEntries[entryIndex] = {
                                      ...entry,
                                      fields: nextFields,
                                    };
                                    onDraftChange({
                                      ...draft,
                                      streamEntries: nextEntries,
                                    });
                                  }}
                                />
                                <RowActions
                                  disabled={disabled}
                                  onRemove={() => {
                                    const nextEntries = [
                                      ...draft.streamEntries,
                                    ];
                                    nextEntries[entryIndex] = {
                                      ...entry,
                                      fields:
                                        entry.fields.length === 1
                                          ? [{ ...EMPTY_STREAM_FIELD }]
                                          : entry.fields.filter(
                                              (_, itemIndex) =>
                                                itemIndex !== fieldIndex,
                                            ),
                                    };
                                    onDraftChange({
                                      ...draft,
                                      streamEntries: nextEntries,
                                    });
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            onClick={() => {
                              const nextEntries = [...draft.streamEntries];
                              nextEntries[entryIndex] = {
                                ...entry,
                                fields: [
                                  ...entry.fields,
                                  { ...EMPTY_STREAM_FIELD },
                                ],
                              };
                              onDraftChange({
                                ...draft,
                                streamEntries: nextEntries,
                              });
                            }}
                          >
                            <PlusIcon className="size-3.5" />
                            Add Field
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          streamEntries: [
                            ...draft.streamEntries,
                            { fields: [{ ...EMPTY_STREAM_FIELD }] },
                          ],
                        })
                      }
                    >
                      <PlusIcon className="size-3.5" />
                      Add Entry
                    </Button>
                  </div>
                )}

                {supportsTTL && (
                  <div className="space-y-1.5">
                    <Label htmlFor="workspace-upsert-ttl">TTL seconds</Label>
                    <InputGroup>
                      <InputGroupAddon>
                        <Clock3Icon className="size-3.5" />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="workspace-upsert-ttl"
                        value={ttlSeconds}
                        onChange={(event) => onTtlChange(event.target.value)}
                        placeholder="Optional"
                        disabled={readOnly}
                      />
                    </InputGroup>
                  </div>
                )}

                {validationMessage && (
                  <p className="text-destructive text-xs">
                    {validationMessage}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="border-t p-4">
            <DialogFooter>
              <Button
                onClick={onSave}
                disabled={
                  readOnly ||
                  isLoading ||
                  isSaving ||
                  keyName.trim().length === 0 ||
                  Boolean(validationMessage)
                }
              >
                <SaveIcon />
                {isSaving
                  ? "Saving..."
                  : isEditMode
                    ? "Save Changes"
                    : "Create Key"}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
