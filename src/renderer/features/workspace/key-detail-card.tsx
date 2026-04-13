import {
  FilePenLineIcon,
  InfoIcon,
  PencilLineIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/renderer/components/ui/card";
import { KeyValueVisualizer } from "@/renderer/features/workspace/key-value-visualizer";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/renderer/components/ui/empty";

type KeyDetailCardProps = {
  keyName: string | null;
  value: string | null;
  ttlSeconds: number | null;
  keyType?: string;
  isStringEditable?: boolean;
  readOnly: boolean;
  supportsTTL: boolean;
  isLoading: boolean;
  errorMessage?: string;
  isRetryableError?: boolean;
  canRollback?: boolean;
  onRetry?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRollback?: () => void;
};

export const KeyDetailCard = ({
  keyName,
  value,
  ttlSeconds,
  keyType,
  isStringEditable,
  readOnly,
  supportsTTL,
  isLoading,
  errorMessage,
  isRetryableError,
  canRollback,
  onRetry,
  onEdit,
  onDelete,
  onRollback,
}: KeyDetailCardProps) => {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Key Detail</CardTitle>
            <CardDescription>
              Read-only view with structure preview.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {readOnly && <Badge variant="outline">Read-only</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              disabled={!keyName || readOnly || isStringEditable === false}
            >
              <PencilLineIcon className="size-3.5" />
              Edit
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex h-full min-h-0 flex-col gap-3">
        {isLoading ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <FilePenLineIcon className="size-3.5" />
            Loading key details...
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
        ) : !keyName ? (
          <Empty className="bg-muted/50 rounded-lg">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InfoIcon />
              </EmptyMedia>
              <EmptyTitle>No Key Selected</EmptyTitle>
              <EmptyDescription>
                Select a key from the browser to inspect its value.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="space-y-1 border p-2 text-xs">
              <p className="text-muted-foreground">Key</p>
              <p className="font-medium break-all">{keyName}</p>
              {keyType && (
                <p className="text-muted-foreground">Type: {keyType}</p>
              )}
              {supportsTTL && (
                <p className="text-muted-foreground">
                  TTL seconds: {ttlSeconds ?? "no expiration"}
                </p>
              )}
              {isStringEditable === false && (
                <p className="text-muted-foreground">
                  This key uses a non-string Redis type and cannot be edited
                  with string upsert.
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1">
              <KeyValueVisualizer keyId={keyName} value={value} />
            </div>

            <div className="flex items-center justify-end gap-2">
              {canRollback && onRollback && (
                <Button variant="outline" size="sm" onClick={onRollback}>
                  Rollback
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={readOnly}
                onClick={onDelete}
              >
                <Trash2Icon className="size-3.5" />
                Delete
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
