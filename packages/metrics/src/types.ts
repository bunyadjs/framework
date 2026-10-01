export type AggregateType = "count" | "min" | "max" | "sum" | "avg";

export type MetricsEntryRecord = {
  type: string;
  key: string;
  value: number;
  timestamp: number;
  aggregations: AggregateType[];
};

export type MetricsValueRecord = {
  type: string;
  key: string;
  value: string;
  timestamp: number;
};

export type MetricsFilter = (
  entry: MetricsEntryRecord | MetricsValueRecord,
) => boolean;

export type MetricsStore = {
  store(
    entries: MetricsEntryRecord[],
    values: MetricsValueRecord[],
  ): void | Promise<void>;
  entries(type?: string): MetricsEntryRecord[];
  values(type?: string): MetricsValueRecord[];
  flush(): void;
};
