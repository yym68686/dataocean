import { useState } from "react";
import { apiClient } from "../api/client";
import type { DataSource } from "../domain/types";
import { formatMetricValue } from "../lib/format";
import { queryEngine } from "../services/queryEngine";
import { useDisplayCurrency } from "../lib/displayCurrency";
import { useI18n } from "../lib/i18n";

type DataSourcesPageProps = {
  dataSources: DataSource[];
};

export function DataSourcesPage({ dataSources }: DataSourcesPageProps) {
  const { intlLocale, t, tx, te } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  async function testSource(source: DataSource) {
    setTestResults((current) => ({ ...current, [source.id]: t("common.testing") }));
    if (source.kind === "zhupay") {
      const status = await apiClient.getZhupayStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: status.configured
          ? t("datasources.zhupayConfigured", { count: status.orderCount })
          : t("datasources.zhupayMissing"),
      }));
      return;
    }

    if (source.kind === "creem") {
      const status = await apiClient.getCreemStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: status.configured
          ? t("datasources.creemConfigured", { mode: status.mode, count: status.transactionCount })
          : t("datasources.creemMissing"),
      }));
      return;
    }

    if (source.kind === "manual") {
      const status = await apiClient.getManualRevenueStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: t("datasources.manualReady", { count: status.entryCount }),
      }));
      return;
    }

    if (source.kind === "sub2api") {
      const status = await apiClient.getSub2ApiStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: status.configured
          ? t("datasources.sub2apiConfigured", {
              count: status.channelCount ?? status.channels.length,
              profit: formatMetricValue(status.totalProfit ?? 0, "currency", status.currency, intlLocale, currencyFormatOptions),
            })
          : t("datasources.sub2apiMissing"),
      }));
      return;
    }

    if (source.kind === "nl2pcb") {
      const status = await apiClient.getNl2PcbStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: status.configured
          ? t("datasources.nl2pcbConfigured", {
              users: status.userCount,
              jobs: status.jobCount,
              feedback: status.feedbackCount,
            })
          : t("datasources.nl2pcbMissing"),
      }));
      return;
    }

    const result = await queryEngine.testDataSource(source);
    setTestResults((current) => ({
      ...current,
      [source.id]: `${result.message} (${result.latencyMs}ms)`,
    }));
  }

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("datasources.title")}</h2>
            <p className="mt-card-subtitle">{t("datasources.subtitle")}</p>
          </div>
          <button className="mt-button" data-variant="primary" type="button">
            {t("datasources.add")}
          </button>
        </div>
        <div className="do-source-grid">
          {dataSources.length === 0 ? (
            <div className="do-empty-state do-source-empty">
              <h2>{t("datasources.emptyTitle")}</h2>
              <p>{t("datasources.emptyText")}</p>
            </div>
          ) : null}
          {dataSources.map((source) => (
            <div className="do-source-tile" key={source.id}>
              <div className="do-source-header">
                <div>
                  <h3>{tx(source.name)}</h3>
                  <p>{tx(source.description)}</p>
                </div>
                <span className="mt-badge" data-intent={source.status === "live" ? "positive" : undefined}>
                  {te("status", source.status)}
                </span>
              </div>
              <dl className="do-definition-list">
                <div>
                  <dt>{t("datasources.kind")}</dt>
                  <dd>{te("kind", source.kind)}</dd>
                </div>
                <div>
                  <dt>{t("datasources.auth")}</dt>
                  <dd>{te("auth", source.auth)}</dd>
                </div>
                <div>
                  <dt>{t("datasources.refresh")}</dt>
                  <dd>{source.refreshIntervalMs / 1000}s</dd>
                </div>
                <div>
                  <dt>{t("datasources.fields")}</dt>
                  <dd>{source.fields.length}</dd>
                </div>
              </dl>
              <div className="do-source-footer">
                <code>{source.endpoint}</code>
                <button className="mt-button" onClick={() => void testSource(source)} type="button">
                  {t("common.test")}
                </button>
              </div>
              {testResults[source.id] ? <p className="do-test-result">{testResults[source.id]}</p> : null}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
