import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK, resources, node } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  resource: new resources.Resource({
    'service.name': 'ai-copilot-svc',
    'service.version': '4.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317',
  }),
  sampler: new node.ParentBasedSampler({
    root: new node.TraceIdRatioBasedSampler(0.1),
  }),
});

sdk.start();
process.on('SIGTERM', () => {
  // Fire-and-forget: the process is already terminating, and a failed
  // flush of pending spans must not delay or block shutdown.
  void sdk.shutdown();
});
