/** Telemetry event names emitted by the cron subsystem. Centralised so a typo can't drift a metric. */
export declare const CRON_SCHEDULED: "cron_scheduled";
export declare const CRON_FIRED: "cron_fired";
export declare const CRON_MISSED: "cron_missed";
export declare const CRON_DELETED: "cron_deleted";
export type CronTelemetryEvent = typeof CRON_SCHEDULED | typeof CRON_FIRED | typeof CRON_MISSED | typeof CRON_DELETED;
