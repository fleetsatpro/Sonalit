const mockAiClient = {
  hasReadyProvider: jest.fn(() => false),
  createMessage: jest.fn(),
  hasOpenSourcePrimary: jest.fn(() => false),
  hasGroqFallback: jest.fn(() => false),
};
jest.mock('../src/utils/aiClient', () => mockAiClient);

const { runDecisionFabric } = require('../src/services/aiSwarm');

describe('Copilot decision fabric resilience', () => {
  beforeEach(() => {
    mockAiClient.hasReadyProvider.mockReset().mockReturnValue(false);
    mockAiClient.createMessage.mockReset();
  });

  test('collects maintenance fleet evidence and returns a deterministic answer during provider outage', async () => {
    const calls = [];
    const executeTool = async (name, input) => {
      calls.push({ name, input });
      if (name === 'query_vehicles') return { vehicles: [{ registration: 'KXX-001X', status: 'active', fuel_level: 82 }] };
      return {};
    };

    const result = await runDecisionFabric({
      command: 'Which trucks are overdue for maintenance?',
      history: [],
      executeTool,
      userId: 'user-1',
      orgId: 'org-1',
    });

    expect(calls).toContainEqual({ name: 'query_vehicles', input: {} });
    expect(result.answer).toContain('Fleet: 1 records');
    expect(result.meta.degraded).toBe(true);
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
  });

  test('uses one synthesis call instead of planner plus multi-agent fan-out when a provider is ready', async () => {
    mockAiClient.hasReadyProvider.mockReturnValue(true);
    mockAiClient.createMessage.mockResolvedValue({
      _provider: 'test-provider',
      content: [{
        type: 'text',
        text: JSON.stringify({
          answer: 'One bounded synthesis response.',
          decision: 'MONITOR',
          risk_level: 'LOW',
          confidence: 0.9,
          recommended_actions: [],
          risks: [],
          evidence: [],
          missing_data: [],
          dissent: [],
          next_check: 'Later',
        }),
      }],
    });

    const result = await runDecisionFabric({
      command: 'Show the current fleet status',
      history: [],
      executeTool: async () => ({ vehicles: [] }),
      userId: 'user-1',
      orgId: 'org-1',
    });

    expect(result.answer).toBe('One bounded synthesis response.');
    expect(result.provider).toBe('test-provider');
    expect(mockAiClient.createMessage).toHaveBeenCalledTimes(1);
  });
});
