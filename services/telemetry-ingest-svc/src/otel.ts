import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'telemetry-ingest-svc',
    [SEMRESATTRS_SERVICE_VERSION]: '4.0.0',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317',
  }),
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.05),
  }),
});

sdk.start();
process.on('SIGTERM', () => { sdk.shutdown(); });
