import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export function initOtel(): void {
  if (import.meta.env['MODE'] === 'test') return;
  const provider = new WebTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: 'sonalit-web' }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: import.meta.env['VITE_OTEL_ENDPOINT'] ?? 'https://api.sonalit.io/otlp/v1/traces' }),
      ),
    ],
  });
  provider.register();
}
