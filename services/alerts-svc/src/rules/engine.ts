export type RuleOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'not_in' | 'contains' | 'exists' | 'between';

export type RuleCondition = {
  field: string;
  operator: RuleOperator;
  value?: unknown;
  negate?: boolean;
};

export type RuleAction = {
  type:
    | 'alert'
    | 'create_incident'
    | 'notify'
    | 'webhook'
    | 'escalate'
    | 'tag'
    | 'log';
  channel?: string;
  recipient?: string;
  template?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  config?: Record<string, unknown>;
};

export type RuleDefinition = {
  conditions: RuleCondition[];
  condition_logic?: 'all' | 'any';
};

export type RuleInput = {
  id: string;
  org_id: string;
  name: string;
  version: number;
  priority: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mode: 'live' | 'dry_run';
  conditions: RuleCondition[];
  condition_logic?: 'all' | 'any';
  actions: RuleAction[];
};

export type RuleEvent = {
  id?: string;
  type: string;
  occurred_at?: number;
  source?: string;
  subject_type?: string;
  subject_id?: string;
  data: Record<string, unknown>;
};

export type ConditionTrace = {
  field: string;
  operator: RuleOperator;
  expected?: unknown;
  actual?: unknown;
  matched: boolean;
};

export type RuleEvaluation = {
  matched: boolean;
  traces: ConditionTrace[];
  action_plan: RuleAction[];
};

function getPath(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, input);
}

function compare(actual: unknown, operator: RuleOperator, expected: unknown): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'in':
      return Array.isArray(expected) && expected.some((v) => v === actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.some((v) => v === actual);
    case 'contains':
      if (Array.isArray(actual)) return actual.some((v) => v === expected);
      if (typeof actual === 'string') return actual.includes(String(expected));
      return false;
    case 'between': {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const n = Number(actual);
      return n >= Number(expected[0]) && n <= Number(expected[1]);
    }
    default:
      return false;
  }
}

export function evaluateRule(rule: RuleInput, event: RuleEvent): RuleEvaluation {
  const traces: ConditionTrace[] = rule.conditions.map((condition) => {
    const actual = getPath(event.data, condition.field);
    let matched = compare(actual, condition.operator, condition.value);
    if (condition.negate) matched = !matched;
    return {
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
      matched,
    };
  });

  const useAny = rule.condition_logic === 'any';
  const matched = traces.length === 0 ? false : useAny
    ? traces.some((trace) => trace.matched)
    : traces.every((trace) => trace.matched);

  return {
    matched,
    traces,
    action_plan: matched ? rule.actions : [],
  };
}

export function renderTemplate(template: string, event: RuleEvent): string {
  return template.replace(/\{([^}]+)\}/g, (_token, path: string) => {
    const value = getPath(event.data, path.trim());
    return value === undefined || value === null ? '' : String(value);
  });
}
