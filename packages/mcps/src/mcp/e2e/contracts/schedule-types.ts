/** Weekday a weekly schedule runs on; the numeric values are the prompt-service wire format, Sunday first. */
export enum ScheduleDayOfWeekEnum {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}

/** Kind of schedule; the string values are the prompt-service wire format. */
export enum ScheduleTypeEnum {
  Weekly = "weekly",
}

/** Status a client may set on a schedule: pause or resume only. */
export enum ScheduleStatusEnum {
  Active = "ACTIVE",
  Paused = "PAUSED",
}
