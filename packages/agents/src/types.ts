export interface IAgent<TInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}

export interface RetryContext {
  retryCount: number;
  previousFailures: string[];
}
