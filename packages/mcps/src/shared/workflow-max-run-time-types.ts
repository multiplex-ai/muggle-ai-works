/** Workflow kinds whose max runtime a start request can override; the string values are the workflowParams.maxRunTimeMs keys. */
export enum WorkflowMaxRunTimeTypeEnum {
  WebsiteScan = "websiteScan",
  TestScriptGeneration = "testScriptGeneration",
  TestScriptGenerationBulk = "testScriptGenerationBulk",
  TestScriptReplay = "testScriptReplay",
  TestScriptReplayBulk = "testScriptReplayBulk",
  ReportGeneration = "reportGeneration",
}
