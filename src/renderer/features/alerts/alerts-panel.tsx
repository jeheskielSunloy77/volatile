import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BellRingIcon,
  ChartColumnBigIcon,
  HashIcon,
  MapIcon,
  ShieldAlertIcon,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Badge } from "@/renderer/components/ui/badge";
import { Button } from "@/renderer/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/renderer/components/ui/alert-dialog";
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
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/renderer/components/ui/chart";
import { Checkbox } from "@/renderer/components/ui/checkbox";
import {
  DashboardChartCard,
  DashboardStats,
} from "@/renderer/components/ui/dashboard";
import { LoadingSkeletonLines } from "@/renderer/components/ui/loading-skeleton";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/renderer/components/ui/input-group";
import { Label } from "@/renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/renderer/components/ui/select";
import { useStartupGateReady } from "@/renderer/app/startup-gate";
import { unwrapResponse } from "@/renderer/features/common/ipc";
import type { AlertRule, ConnectionProfile } from "@/shared/contracts/cache";

type AlertsPanelProps = {
  connection: ConnectionProfile | null;
};

const getSeverityVariant = (
  severity: "info" | "warning" | "critical",
): "default" | "outline" | "destructive" => {
  if (severity === "critical") {
    return "destructive";
  }

  if (severity === "warning") {
    return "outline";
  }

  return "default";
};

type RuleFormState = {
  name: string;
  metric: AlertRule["metric"];
  threshold: string;
  lookbackMinutes: string;
  severity: AlertRule["severity"];
  connectionScoped: boolean;
  connectionId: string;
  environment: "" | "dev" | "staging" | "prod";
  enabled: boolean;
};

const alertMetricLabels = {
  errorRate: "Error Rate",
  latencyP95Ms: "Latency P95 (ms)",
  slowOperationCount: "Slow Operation Count",
  failedOperationCount: "Failed Operation Count",
} as const;

const alertSeverityLabels = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
} as const;

const alertEnvironmentLabels = {
  "": "all",
  dev: "dev",
  staging: "staging",
  prod: "prod",
} as const;

const createDefaultRuleForm = (
  connection: ConnectionProfile | null,
): RuleFormState => ({
  name: "",
  metric: "errorRate",
  threshold: "0.2",
  lookbackMinutes: "5",
  severity: "warning",
  connectionScoped: Boolean(connection),
  connectionId: connection?.id ?? "",
  environment: connection?.environment ?? "",
  enabled: true,
});

const toRuleDraft = (form: RuleFormState) => {
  const threshold = Number(form.threshold);
  if (!Number.isFinite(threshold)) {
    throw new Error("Threshold must be a valid number.");
  }

  const lookbackMinutes = Math.max(1, Number(form.lookbackMinutes) || 1);

  if (form.connectionScoped && form.connectionId.trim().length === 0) {
    throw new Error(
      "Connection ID is required when connection scope is enabled.",
    );
  }

  return {
    name: form.name.trim() || "Untitled Rule",
    metric: form.metric,
    threshold,
    lookbackMinutes,
    severity: form.severity,
    connectionId: form.connectionScoped ? form.connectionId.trim() : undefined,
    environment: form.environment || undefined,
    enabled: form.enabled,
  };
};

const toRuleFormState = (rule: AlertRule): RuleFormState => ({
  name: rule.name,
  metric: rule.metric,
  threshold: String(rule.threshold),
  lookbackMinutes: String(rule.lookbackMinutes),
  severity: rule.severity,
  connectionScoped: Boolean(rule.connectionId),
  connectionId: rule.connectionId ?? "",
  environment: rule.environment ?? "",
  enabled: rule.enabled,
});

export const AlertsPanel = ({ connection }: AlertsPanelProps) => {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = React.useState(false);
  const [ruleForm, setRuleForm] = React.useState<RuleFormState>(() =>
    createDefaultRuleForm(connection),
  );

  React.useEffect(() => {
    if (editingRuleId) {
      return;
    }

    setRuleForm((current) => ({
      ...current,
      connectionId: connection?.id ?? "",
      environment: current.environment || connection?.environment || "",
    }));
  }, [connection, editingRuleId]);

  const alertsQuery = useQuery({
    queryKey: ["alerts", unreadOnly],
    queryFn: async () =>
      unwrapResponse(
        await window.desktopApi.listAlerts({
          unreadOnly,
          limit: 100,
        }),
      ),
  });

  const rulesQuery = useQuery({
    queryKey: ["alert-rules"],
    queryFn: async () =>
      unwrapResponse(await window.desktopApi.listAlertRules()),
  });
  useStartupGateReady(
    "alerts-page",
    !alertsQuery.isLoading && !rulesQuery.isLoading,
  );

  const markReadMutation = useMutation({
    mutationFn: async (id: string) =>
      unwrapResponse(
        await window.desktopApi.markAlertRead({
          id,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Unable to mark alert read.",
      );
    },
  });

  const deleteAllAlertsMutation = useMutation({
    mutationFn: async () =>
      unwrapResponse(await window.desktopApi.deleteAllAlerts()),
    onSuccess: async () => {
      setDeleteAllOpen(false);
      toast.success("All alerts deleted.");
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete alerts.",
      );
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: async () => {
      const rule = toRuleDraft(ruleForm);

      if (editingRuleId) {
        return unwrapResponse(
          await window.desktopApi.updateAlertRule({
            id: editingRuleId,
            rule,
          }),
        );
      }

      return unwrapResponse(
        await window.desktopApi.createAlertRule({
          rule,
        }),
      );
    },
    onSuccess: async (rule) => {
      setEditingRuleId(rule.id);
      setRuleForm(toRuleFormState(rule));
      toast.success("Alert rule saved.");
      await queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Unable to save alert rule.",
      );
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) =>
      unwrapResponse(
        await window.desktopApi.deleteAlertRule({
          id,
        }),
      ),
    onSuccess: async () => {
      setEditingRuleId(null);
      setRuleForm(createDefaultRuleForm(connection));
      toast.success("Alert rule deleted.");
      await queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete alert rule.",
      );
    },
  });

  const resetRuleForm = React.useCallback(() => {
    setEditingRuleId(null);
    setRuleForm(createDefaultRuleForm(connection));
  }, [connection]);

  const alerts = alertsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const unreadCount = alerts.filter((alert) => !alert.read).length;
  const criticalCount = alerts.filter(
    (alert) => alert.severity === "critical",
  ).length;
  const severityData = [
    {
      severity: "info",
      value: alerts.filter((alert) => alert.severity === "info").length,
      fill: "var(--color-info)",
    },
    {
      severity: "warning",
      value: alerts.filter((alert) => alert.severity === "warning").length,
      fill: "var(--color-warning)",
    },
    {
      severity: "critical",
      value: criticalCount,
      fill: "var(--color-critical)",
    },
  ].filter((item) => item.value > 0);
  const ruleMetricData = [
    "errorRate",
    "latencyP95Ms",
    "slowOperationCount",
    "failedOperationCount",
  ].map((metric) => ({
    metric,
    rules: rules.filter((rule) => rule.metric === metric).length,
    enabled: rules.filter((rule) => rule.metric === metric && rule.enabled)
      .length,
  }));
  const chartConfig = {
    info: { label: "Info", color: "var(--chart-1)" },
    warning: { label: "Warning", color: "var(--chart-4)" },
    critical: { label: "Critical", color: "var(--destructive)" },
    value: { label: "Alerts", color: "var(--chart-1)" },
    rules: { label: "Rules", color: "var(--chart-1)" },
    enabled: { label: "Enabled", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <>
      <div className="grid min-h-0 gap-3">
        <DashboardStats
          items={[
            {
              label: "Alerts In View",
              value: alerts.length,
              description: unreadOnly
                ? "Unread-only filter active"
                : "Current alert feed sample",
            },
            {
              label: "Unread",
              value: unreadCount,
              description: `${alerts.length - unreadCount} already acknowledged`,
              tone: unreadCount > 0 ? "warning" : "positive",
            },
            {
              label: "Critical",
              value: criticalCount,
              description: "Highest-severity incidents in the active feed",
              tone: criticalCount > 0 ? "danger" : "default",
            },
            {
              label: "Rules Enabled",
              value: rules.filter((rule) => rule.enabled).length,
              description: `${rules.length} total alert rules`,
            },
          ]}
        />

        <div className="grid gap-3 xl:grid-cols-2">
          <DashboardChartCard
            title="Severity Distribution"
            description="Alert volume split by severity."
            loading={alertsQuery.isLoading}
            error={
              alertsQuery.isError
                ? alertsQuery.error instanceof Error
                  ? alertsQuery.error.message
                  : "Failed to load alerts."
                : undefined
            }
            empty={
              severityData.length === 0 ? (
                <Empty className="bg-muted/50 min-h-[220px]">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ChartColumnBigIcon className="size-4" />
                    </EmptyMedia>
                    <EmptyTitle>No alert data to visualize</EmptyTitle>
                    <EmptyDescription>
                      Alert severity will appear here once the feed contains
                      events.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : undefined
            }
          >
            <ChartContainer
              config={chartConfig}
              className="mx-auto min-h-[16rem] w-full max-w-[20rem]"
            >
              <PieChart accessibilityLayer>
                <ChartTooltip
                  content={<ChartTooltipContent nameKey="severity" />}
                />
                <Pie
                  data={severityData}
                  dataKey="value"
                  nameKey="severity"
                  innerRadius={48}
                  outerRadius={78}
                >
                  {severityData.map((entry) => (
                    <Cell key={entry.severity} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartLegend
                  content={<ChartLegendContent nameKey="severity" />}
                />
              </PieChart>
            </ChartContainer>
          </DashboardChartCard>

          <DashboardChartCard
            title="Rule Coverage"
            description="Saved rules by monitored metric, with enabled-rule overlay."
            loading={rulesQuery.isLoading}
            error={
              rulesQuery.isError
                ? rulesQuery.error instanceof Error
                  ? rulesQuery.error.message
                  : "Failed to load alert rules."
                : undefined
            }
            empty={
              ruleMetricData.every((item) => item.rules === 0) ? (
                <Empty className="bg-muted/50 min-h-[220px]">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ShieldAlertIcon className="size-4" />
                    </EmptyMedia>
                    <EmptyTitle>No alert rules configured yet</EmptyTitle>
                    <EmptyDescription>
                      Create a rule to start tracking operational signals.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : undefined
            }
          >
            <ChartContainer
              config={chartConfig}
              className="min-h-[16rem] w-full"
            >
              <BarChart accessibilityLayer data={ruleMetricData}>
                <XAxis
                  dataKey="metric"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="rules" fill="var(--color-rules)" radius={0} />
                <Bar dataKey="enabled" fill="var(--color-enabled)" radius={0} />
              </BarChart>
            </ChartContainer>
          </DashboardChartCard>
        </div>

        <div className="grid min-h-0 gap-3 xl:grid-cols-2">
          <Card className="min-h-0 rounded-none border shadow-none">
            <CardHeader>
              <CardTitle>Alert Rule Builder</CardTitle>
              <CardDescription>
                Configure threshold and rate-based rules for operational
                signals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="alert-rule-name">Rule Name</Label>
                  <InputGroup>
                    <InputGroupAddon>
                      <BellRingIcon className="size-3.5" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="alert-rule-name"
                      value={ruleForm.name}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="High error rate"
                    />
                  </InputGroup>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-rule-metric">Metric</Label>
                  <Select
                    value={ruleForm.metric}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,
                        metric: value as AlertRule["metric"],
                      }))
                    }
                  >
                    <SelectTrigger id="alert-rule-metric" className="w-full">
                      <ChartColumnBigIcon className="size-3.5" />
                      <SelectValue>
                        {alertMetricLabels[ruleForm.metric]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="errorRate">errorRate</SelectItem>
                      <SelectItem value="latencyP95Ms">latencyP95Ms</SelectItem>
                      <SelectItem value="slowOperationCount">
                        slowOperationCount
                      </SelectItem>
                      <SelectItem value="failedOperationCount">
                        failedOperationCount
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-rule-threshold">Threshold</Label>
                  <InputGroup>
                    <InputGroupAddon>
                      <AlertTriangleIcon className="size-3.5" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="alert-rule-threshold"
                      value={ruleForm.threshold}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          threshold: event.target.value,
                        }))
                      }
                    />
                  </InputGroup>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-rule-lookback">
                    Lookback (minutes)
                  </Label>
                  <InputGroup>
                    <InputGroupAddon>
                      <HashIcon className="size-3.5" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="alert-rule-lookback"
                      value={ruleForm.lookbackMinutes}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          lookbackMinutes: event.target.value,
                        }))
                      }
                    />
                  </InputGroup>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-rule-severity">Severity</Label>
                  <Select
                    value={ruleForm.severity}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,
                        severity: value as AlertRule["severity"],
                      }))
                    }
                  >
                    <SelectTrigger id="alert-rule-severity" className="w-full">
                      <AlertTriangleIcon className="size-3.5" />
                      <SelectValue>
                        {alertSeverityLabels[ruleForm.severity]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">info</SelectItem>
                      <SelectItem value="warning">warning</SelectItem>
                      <SelectItem value="critical">critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-rule-environment">
                    Environment Scope
                  </Label>
                  <Select
                    value={ruleForm.environment}
                    onValueChange={(value) =>
                      setRuleForm((current) => ({
                        ...current,
                        environment: value as RuleFormState["environment"],
                      }))
                    }
                  >
                    <SelectTrigger
                      id="alert-rule-environment"
                      className="w-full"
                    >
                      <MapIcon className="size-3.5" />
                      <SelectValue>
                        {alertEnvironmentLabels[ruleForm.environment]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">all</SelectItem>
                      <SelectItem value="dev">dev</SelectItem>
                      <SelectItem value="staging">staging</SelectItem>
                      <SelectItem value="prod">prod</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 rounded-none border p-2 text-xs">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={ruleForm.connectionScoped}
                    onCheckedChange={(checked) =>
                      setRuleForm((current) => ({
                        ...current,
                        connectionScoped: Boolean(checked),
                      }))
                    }
                  />
                  Scope to a specific connection
                </label>
                {ruleForm.connectionScoped && (
                  <div className="space-y-1.5">
                    <Label htmlFor="alert-rule-connection-id">
                      Connection ID
                    </Label>
                    <InputGroup>
                      <InputGroupAddon>
                        <ShieldAlertIcon className="size-3.5" />
                      </InputGroupAddon>
                      <InputGroupInput
                        id="alert-rule-connection-id"
                        value={ruleForm.connectionId}
                        onChange={(event) =>
                          setRuleForm((current) => ({
                            ...current,
                            connectionId: event.target.value,
                          }))
                        }
                      />
                    </InputGroup>
                  </div>
                )}
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={ruleForm.enabled}
                    onCheckedChange={(checked) =>
                      setRuleForm((current) => ({
                        ...current,
                        enabled: Boolean(checked),
                      }))
                    }
                  />
                  Rule enabled
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => saveRuleMutation.mutate()}
                  disabled={saveRuleMutation.isPending}
                >
                  {editingRuleId ? "Update Rule" : "Create Rule"}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetRuleForm}
                  disabled={saveRuleMutation.isPending}
                >
                  New Rule
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (editingRuleId) {
                      deleteRuleMutation.mutate(editingRuleId);
                    }
                  }}
                  disabled={!editingRuleId || deleteRuleMutation.isPending}
                >
                  Delete Rule
                </Button>
              </div>

              <div className="max-h-56 space-y-2 overflow-auto border p-2">
                {(rulesQuery.data?.length ?? 0) === 0 ? (
                  <Empty className="bg-muted/50 min-h-[160px]">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ShieldAlertIcon className="size-4" />
                      </EmptyMedia>
                      <EmptyTitle>No alert rules configured yet</EmptyTitle>
                      <EmptyDescription>
                        Create a rule to start tracking operational signals.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  rulesQuery.data?.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      className="w-full space-y-1 border p-2 text-left text-xs hover:bg-muted/40"
                      onClick={() => {
                        setEditingRuleId(rule.id);
                        setRuleForm(toRuleFormState(rule));
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium">{rule.name}</p>
                        <div className="flex items-center gap-1">
                          <Badge variant={getSeverityVariant(rule.severity)}>
                            {rule.severity}
                          </Badge>
                          <Badge variant={rule.enabled ? "default" : "outline"}>
                            {rule.enabled ? "enabled" : "disabled"}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-muted-foreground">
                        {rule.metric} &gt; {rule.threshold} |{" "}
                        {rule.lookbackMinutes}m
                      </p>
                      <p className="text-muted-foreground truncate">
                        connection: {rule.connectionId ?? "all"} | env:{" "}
                        {rule.environment ?? "all"}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-0 rounded-none border shadow-none">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle>Alerts</CardTitle>
                  <CardDescription>In-app alert feed.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={unreadOnly}
                      onCheckedChange={(checked) =>
                        setUnreadOnly(Boolean(checked))
                      }
                    />
                    Unread only
                  </label>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteAllOpen(true)}
                    disabled={
                      deleteAllAlertsMutation.isPending || alerts.length === 0
                    }
                  >
                    <Trash2 />
                    Delete All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="max-h-[calc(100vh-360px)] space-y-2 overflow-auto">
              {alertsQuery.isLoading ? (
                <div className="space-y-2">
                  <LoadingSkeletonLines
                    count={4}
                    widths={["w-5/6", "w-2/3", "w-3/4", "w-1/2"]}
                  />
                </div>
              ) : (alertsQuery.data?.length ?? 0) === 0 ? (
                <Empty className="bg-muted/50 min-h-96">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <BellRingIcon className="size-4" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {unreadOnly ? "No unread alerts" : "No alerts found"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {unreadOnly
                        ? "Everything in this workspace has already been acknowledged."
                        : "There are no alerts in this workspace yet."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                alertsQuery.data?.map((alert) => (
                  <div key={alert.id} className="space-y-2 border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{alert.title}</p>
                        <p className="text-muted-foreground truncate">
                          {new Date(alert.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getSeverityVariant(alert.severity)}>
                          {alert.severity}
                        </Badge>
                        {alert.read ? (
                          <Badge variant="outline">read</Badge>
                        ) : null}
                      </div>
                    </div>

                    <p>{alert.message}</p>

                    <div className="text-muted-foreground flex items-center gap-2">
                      <span>source: {alert.source}</span>
                      {alert.environment && (
                        <span>env: {alert.environment}</span>
                      )}
                      {alert.connectionId && (
                        <span>connection: {alert.connectionId}</span>
                      )}
                    </div>

                    {!alert.read && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => markReadMutation.mutate(alert.id)}
                        disabled={markReadMutation.isPending}
                      >
                        Mark As Read
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all alerts?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every alert in the database. The feed and
              unread count will reset immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteAllAlertsMutation.mutate()}
              disabled={deleteAllAlertsMutation.isPending}
            >
              Delete all alerts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
