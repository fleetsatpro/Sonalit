declare module 'pg' {
  export interface PoolConfig {
    connectionString?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }
  export interface QueryResult<T> {
    rows: T[];
    rowCount: number | null;
  }
  export interface PoolClient {
    query<T extends object = object>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    release(): void;
  }
  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    query<T extends object = object>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
}
