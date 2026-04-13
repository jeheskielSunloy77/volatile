import {
  FilePenLineIcon,
  HashIcon,
  KeyRoundIcon,
  CircleDashedIcon,
  ListIcon,
  RefreshCwIcon,
  SigmaIcon,
  SearchIcon,
  ActivityIcon,
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/renderer/components/ui/empty";
import { Input } from "@/renderer/components/ui/input";
import { Separator } from "@/renderer/components/ui/separator";
import { LoadingSkeletonLines } from "@/renderer/components/ui/loading-skeleton";
import type { KeyListEntry } from "@/shared/contracts/cache";

type KeyListCardProps = {
  title: string;
  keys: KeyListEntry[];
  selectedKey: string | null;
  searchPattern: string;
  isLoading: boolean;
  errorMessage?: string;
  isRetryableError?: boolean;
  readOnly: boolean;
  hasNextPage: boolean;
  totalKeys?: number;
  totalFoundKeys?: number;
  isCountLoading?: boolean;
  getNamespaceBadge?: (key: string) => string | undefined;
  getNamespacePrefix?: (key: string) => string | undefined;
  onSearchPatternChange: (value: string) => void;
  onSelectKey: (key: string) => void;
  onEditKey: (key: string) => void;
  onDeleteKey: (key: string) => void;
  onRefresh: () => void;
  onRetry?: () => void;
  onLoadNextPage: () => void;
};

const formatTtlLabel = (ttlSeconds: number | null | undefined): string | null => {
  if (ttlSeconds === null) {
    return null;
  }

  if (typeof ttlSeconds !== "number") {
    return null;
  }

  if (ttlSeconds < 60) {
    return `${ttlSeconds}s`;
  }

  if (ttlSeconds < 3600) {
    return `${Math.floor(ttlSeconds / 60)}m`;
  }

  if (ttlSeconds < 86400) {
    return `${Math.floor(ttlSeconds / 3600)}h`;
  }

  return `${Math.floor(ttlSeconds / 86400)}d`;
};

const getKeyTypePresentation = (
  keyType: KeyListEntry["keyType"],
): { title: string; label: string; Icon: typeof KeyRoundIcon } | null => {
  switch (keyType) {
    case "string":
      return {
        title: "string",
        label: "string",
        Icon: KeyRoundIcon,
      };
    case "hash":
      return {
        title: "hash",
        label: "hash",
        Icon: HashIcon,
      };
    case "list":
      return {
        title: "list",
        label: "list",
        Icon: ListIcon,
      };
    case "set":
      return {
        title: "set",
        label: "set",
        Icon: CircleDashedIcon,
      };
    case "zset":
      return {
        title: "sorted set",
        label: "sorted set",
        Icon: SigmaIcon,
      };
    case "stream":
      return {
        title: "stream",
        label: "stream",
        Icon: ActivityIcon,
      };
    default:
      return null;
  }
};

const renderCountLabel = (
  searchPattern: string,
  totalKeys?: number,
  totalFoundKeys?: number,
  isCountLoading?: boolean,
): string => {
  if (isCountLoading) {
    return "Counting keys...";
  }

  if (typeof totalKeys !== "number") {
    return "Pattern search supports wildcard syntax such as user:*.";
  }

  if (searchPattern.trim().length > 0 && typeof totalFoundKeys === "number") {
    return `Total keys: ${totalKeys} • Found: ${totalFoundKeys}`;
  }

  return `Total keys: ${totalKeys}`;
};

export const KeyListCard = ({
  title,
  keys,
  selectedKey,
  searchPattern,
  isLoading,
  errorMessage,
  isRetryableError,
  readOnly,
  hasNextPage,
  totalKeys,
  totalFoundKeys,
  isCountLoading,
  getNamespaceBadge,
  getNamespacePrefix,
  onSearchPatternChange,
  onSelectKey,
  onEditKey,
  onDeleteKey,
  onRefresh,
  onRetry,
  onLoadNextPage,
}: KeyListCardProps) => {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              {renderCountLabel(
                searchPattern,
                totalKeys,
                totalFoundKeys,
                isCountLoading,
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex h-full min-h-0 flex-col gap-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            className="pl-7"
            placeholder="Search keys by pattern"
            value={searchPattern}
            onChange={(event) => onSearchPatternChange(event.target.value)}
          />
        </div>

        <Separator />

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-2 p-2">
              <LoadingSkeletonLines
                count={5}
                widths={["w-5/6", "w-3/4", "w-2/3", "w-4/5", "w-1/2"]}
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
          ) : keys.length === 0 ? (
            <Empty className="bg-muted/50 min-h-0 flex-1">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon className="size-4" />
                </EmptyMedia>
                <EmptyTitle>No keys found</EmptyTitle>
                <EmptyDescription>
                  {searchPattern.trim().length > 0
                    ? "Try a broader pattern or clear the search to inspect every key in the workspace."
                    : "This namespace does not have any keys yet."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            keys.map((item) => {
              const namespaceName = getNamespaceBadge?.(item.key);
              const namespacePrefix = getNamespacePrefix?.(item.key);
              const ttlLabel = formatTtlLabel(item.ttlSeconds);
              const typePresentation = getKeyTypePresentation(item.keyType);
              const TypeIcon = typePresentation?.Icon;
              const hasPrefixHighlight =
                typeof namespacePrefix === "string" &&
                namespacePrefix.length > 0 &&
                item.key.startsWith(namespacePrefix);

              return (
                <div
                  key={item.key}
                  className={`group flex cursor-pointer items-start justify-between rounded-none border px-2 py-1.5 text-xs ${
                    item.key === selectedKey
                      ? "border-primary bg-primary/10"
                      : "hover:bg-muted/50 border-transparent"
                  }`}
                  onClick={() => onSelectKey(item.key)}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <div className="min-w-0 truncate">
                      {hasPrefixHighlight ? (
                        <>
                          <span className="rounded-sm bg-muted px-1 py-0.5 font-medium text-foreground">
                            {namespacePrefix}
                          </span>
                          <span>{item.key.slice(namespacePrefix.length)}</span>
                        </>
                      ) : (
                        <span className="truncate">{item.key}</span>
                      )}
                      {namespaceName && (
                        <Badge className="ml-2" variant="outline">
                          {namespaceName}
                        </Badge>
                      )}
                    </div>
                    {(typePresentation || item.ttlSeconds !== null) && (
                      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5">
                        {TypeIcon && typePresentation && (
                          <Badge
                            variant="outline"
                            title={typePresentation.title}
                            aria-label={typePresentation.title}
                          >
                            <TypeIcon className="size-3.5" />
                            <span>{typePresentation.label}</span>
                          </Badge>
                        )}
                        {ttlLabel && (
                          <Badge
                            variant="outline"
                            className="transition-all opacity-100 group-hover:opacity-100"
                          >
                            TTL {ttlLabel}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-2">
                    {!readOnly ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => onEditKey(item.key)}
                        >
                          <FilePenLineIcon className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => onDeleteKey(item.key)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Badge variant="outline">RO</Badge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {hasNextPage && (
          <Button variant="outline" size="sm" onClick={onLoadNextPage}>
            Load Next Page
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
