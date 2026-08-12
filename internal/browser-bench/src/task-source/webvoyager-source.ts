import { type BenchmarkTask } from "../domain/types";

interface WebVoyagerRecord {
  web_name?: string;
  id?: string;
  ques?: string;
  web?: string;
}

const REQUIRED_FIELDS: (keyof WebVoyagerRecord)[] = ["web_name", "id", "ques", "web"];

/**
 * Parses WebVoyager's `WebVoyager_data.jsonl` into benchmark tasks.
 *
 * Output shape: `[{ taskId: "Allrecipes--3", siteName: "Allrecipes",
 * instruction: "Find a recipe…", startUrl: "https://www.allrecipes.com/" }]`
 *
 * @param jsonlContent - Raw file contents, one JSON object per line.
 * @throws When a non-blank line is unparseable or missing a required field.
 */
export const loadWebVoyagerTasks = (jsonlContent: string): BenchmarkTask[] => {
  const tasks: BenchmarkTask[] = [];

  jsonlContent.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") return;

    let record: WebVoyagerRecord;
    try {
      record = JSON.parse(line) as WebVoyagerRecord;
    } catch {
      throw new Error(`WebVoyager task file line ${index + 1} is not valid JSON.`);
    }

    const missingFields = REQUIRED_FIELDS.filter((field) => record[field] === undefined);
    if (missingFields.length > 0) {
      throw new Error(
        `WebVoyager task file line ${index + 1} is missing required field(s): ${missingFields.join(", ")}.`,
      );
    }

    tasks.push({
      taskId: record.id!,
      siteName: record.web_name!,
      instruction: record.ques!,
      startUrl: record.web!,
    });
  });

  return tasks;
};
