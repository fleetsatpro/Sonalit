import { NodeSDK, resources, node } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';

const sdk = new NodeSDK({
  resource: new resources.Resource({
    'service.name': 'telemetry-ingest-svc',
    'service.version': '4.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317',
  }),
  sampler: new node.ParentBasedSampler({
    root: new node.TraceIdRatioBasedSampler(0.05),
  }),
});

sdk.start();
process.on('SIGTERM', () => { sdk.shutdown(); });
