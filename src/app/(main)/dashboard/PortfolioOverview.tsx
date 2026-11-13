'use client';
import { useQueries } from '@tanstack/react-query';
import { Column, Grid, Heading, Row, StatusLight, Text } from '@umami/react-zen';
import { useMemo } from 'react';
import { Empty } from '@/components/common/Empty';
import { Favicon } from '@/components/common/Favicon';
import Link from '@/components/common/Link';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import {
  useApi,
  useDateParameters,
  useDateRange,
  useLocale,
  useMessages,
  useNavigation,
} from '@/components/hooks';
import type { WebsitePageviewsData } from '@/components/hooks/queries/useWebsitePageviewsQuery';
import type { WebsiteStatsData } from '@/components/hooks/queries/useWebsiteStatsQuery';
import { WebsiteDateFilter } from '@/components/input/WebsiteDateFilter';
import { ChangeLabel } from '@/components/metrics/ChangeLabel';
import { MetricCard } from '@/components/metrics/MetricCard';
import { MetricsBar } from '@/components/metrics/MetricsBar';
import { generateTimeSeries } from '@/lib/date';
import { formatLongNumber, formatShortTime } from '@/lib/format';

const MAX_WEBSITES = 100;
const ACTIVE_REFETCH_INTERVAL = 60000;
const ROW_COLUMNS = 'minmax(180px, 2fr) 140px repeat(4, minmax(72px, 1fr))';

interface Website {
  id: string;
  name: string;
  domain: string;
}

function Sparkline({ values }: { values: number[] }) {
  const width = 120;
  const height = 32;
  const max = Math.max(...values, 0);

  if (values.length < 2 || max === 0) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <line
          x1={0}
          x2={width}
          y1={height - 1}
          y2={height - 1}
          stroke="var(--text-muted)"
          strokeOpacity={0.4}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - 2 - (v / max) * (height - 4)}`);
  const line = `M${points.join(' L')}`;

  return (
    <svg width={width} height={height} aria-hidden="true">
      <path
        d={`${line} L${width},${height} L0,${height} Z`}
        fill="var(--status-success)"
        fillOpacity={0.12}
      />
      <path d={line} fill="none" stroke="var(--status-success)" strokeWidth={1.5} />
    </svg>
  );
}

function NumberCell({ children }: { children: string }) {
  return (
    <Text weight="medium" wrap="nowrap" style={{ textAlign: 'right' }}>
      {children}
    </Text>
  );
}

export function PortfolioOverview({ showDateFilter = true }: { showDateFilter?: boolean }) {
  const { get, useQuery } = useApi();
  const { t, labels } = useMessages();
  const { locale } = useLocale();
  const { renderUrl } = useNavigation();
  const { dateRange, isAllTime } = useDateRange();
  const { startAt, endAt, unit, timezone } = useDateParameters();

  const websitesQuery = useQuery<{ data: Website[] }>({
    queryKey: ['portfolio:websites'],
    queryFn: () => get('/me/websites', { pageSize: MAX_WEBSITES }),
  });
  const websites = websitesQuery.data?.data ?? [];

  const stats = useQueries({
    queries: websites.map(({ id }) => ({
      queryKey: ['websites:stats', { websiteId: id, startAt, endAt }],
      queryFn: (): Promise<WebsiteStatsData> => get(`/websites/${id}/stats`, { startAt, endAt }),
    })),
  });

  const pageviews = useQueries({
    queries: websites.map(({ id }) => ({
      queryKey: ['websites:pageviews', { websiteId: id, startAt, endAt, unit, timezone }],
      queryFn: (): Promise<WebsitePageviewsData> =>
        get(`/websites/${id}/pageviews`, { startAt, endAt, unit, timezone }),
    })),
  });

  const active = useQueries({
    queries: websites.map(({ id }) => ({
      queryKey: ['websites:active', id],
      queryFn: (): Promise<{ visitors: number }> => get(`/websites/${id}/active`),
      refetchInterval: ACTIVE_REFETCH_INTERVAL,
    })),
  });

  const rows = useMemo(() => {
    return websites
      .map((website, i) => {
        const s = stats[i]?.data;
        const visits = s?.visits ?? 0;
        const series = pageviews[i]?.data?.pageviews;

        return {
          ...website,
          isLoading: !s,
          visitors: s?.visitors ?? 0,
          prevVisitors: s?.comparison?.visitors ?? 0,
          visits,
          pageviews: s?.pageviews ?? 0,
          bounceRate: visits ? (Math.min(visits, s.bounces) / visits) * 100 : 0,
          duration: visits ? s.totaltime / visits : 0,
          online: active[i]?.data?.visitors ?? 0,
          trend: series
            ? generateTimeSeries(series, dateRange.startDate, dateRange.endDate, unit, locale).map(
                ({ y }) => y ?? 0,
              )
            : [],
        };
      })
      .sort((a, b) => b.visitors - a.visitors || b.pageviews - a.pageviews);
  }, [websites, stats, pageviews, active, dateRange, unit, locale]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        visitors: acc.visitors + row.visitors,
        prevVisitors: acc.prevVisitors + row.prevVisitors,
        visits: acc.visits + row.visits,
        pageviews: acc.pageviews + row.pageviews,
        online: acc.online + row.online,
        prevVisits: acc.prevVisits,
        prevPageviews: acc.prevPageviews,
      }),
      {
        visitors: 0,
        prevVisitors: 0,
        visits: 0,
        pageviews: 0,
        online: 0,
        prevVisits: stats.reduce((n, q) => n + (q.data?.comparison?.visits ?? 0), 0),
        prevPageviews: stats.reduce((n, q) => n + (q.data?.comparison?.pageviews ?? 0), 0),
      },
    );
  }, [rows, stats]);

  const statsLoading = stats.some(q => q.isLoading);

  return (
    <Column gap="6" marginBottom="6">
      {showDateFilter && (
        <Row justifyContent="flex-end">
          <WebsiteDateFilter showAllTime={false} />
        </Row>
      )}
      <LoadingPanel
        data={websitesQuery.data}
        isEmpty={websitesQuery.data && websites.length === 0}
        isLoading={websitesQuery.isLoading}
        error={websitesQuery.error}
        renderEmpty={() => <Empty />}
        minHeight="300px"
      >
        <Column gap="6">
          <MetricsBar>
            <MetricCard
              label={t(labels.visitors)}
              value={totals.visitors}
              change={totals.visitors - totals.prevVisitors}
              formatValue={formatLongNumber}
              showChange={!isAllTime && !statsLoading}
            />
            <MetricCard
              label={t(labels.visits)}
              value={totals.visits}
              change={totals.visits - totals.prevVisits}
              formatValue={formatLongNumber}
              showChange={!isAllTime && !statsLoading}
            />
            <MetricCard
              label={t(labels.views)}
              value={totals.pageviews}
              change={totals.pageviews - totals.prevPageviews}
              formatValue={formatLongNumber}
              showChange={!isAllTime && !statsLoading}
            />
            <MetricCard
              label={t(labels.online)}
              value={totals.online}
              formatValue={formatLongNumber}
            />
          </MetricsBar>

          <Column border borderRadius backgroundColor="surface-base" style={{ overflowX: 'auto' }}>
            <Column style={{ minWidth: 720 }}>
              <Grid columns={ROW_COLUMNS} gap="4" paddingX="6" paddingY="4" alignItems="center">
                <Heading size="lg">{t(labels.websites)}</Heading>
                <span />
                {[labels.visitors, labels.views, labels.bounceRate, labels.visitDuration].map(
                  label => (
                    <Text
                      key={label}
                      size="sm"
                      color="muted"
                      weight="bold"
                      wrap="nowrap"
                      style={{ textAlign: 'right' }}
                    >
                      {t(label)}
                    </Text>
                  ),
                )}
              </Grid>
              {rows.map(row => {
                const change = row.visitors - row.prevVisitors;
                const pct = row.prevVisitors
                  ? (change / row.prevVisitors) * 100
                  : row.visitors
                    ? 100
                    : 0;

                return (
                  <Link
                    key={row.id}
                    href={renderUrl(`/websites/${row.id}`)}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    <Grid
                      columns={ROW_COLUMNS}
                      gap="4"
                      paddingX="6"
                      paddingY="3"
                      alignItems="center"
                      border="top"
                      style={{ opacity: row.isLoading ? 0.5 : 1 }}
                    >
                      <Row alignItems="center" gap="3" style={{ minWidth: 0 }}>
                        <Favicon domain={row.domain} />
                        <Column style={{ minWidth: 0 }}>
                          <Row alignItems="center" gap="3">
                            <Text weight="bold" truncate>
                              {row.name}
                            </Text>
                            {row.online > 0 && (
                              <StatusLight variant="success">
                                <Text size="sm" wrap="nowrap">
                                  {row.online} {t(labels.online)}
                                </Text>
                              </StatusLight>
                            )}
                          </Row>
                          <Text size="sm" color="muted" truncate>
                            {row.domain}
                          </Text>
                        </Column>
                      </Row>
                      <Sparkline values={row.trend} />
                      <Row alignItems="center" justifyContent="flex-end" gap="3">
                        {!isAllTime && !row.isLoading && change !== 0 && (
                          <ChangeLabel value={change} size="xs" alignSelf="center">
                            <Text size="sm">{Math.abs(Math.round(pct))}%</Text>
                          </ChangeLabel>
                        )}
                        <NumberCell>{formatLongNumber(row.visitors)}</NumberCell>
                      </Row>
                      <NumberCell>{formatLongNumber(row.pageviews)}</NumberCell>
                      <NumberCell>{`${Math.round(row.bounceRate)}%`}</NumberCell>
                      <NumberCell>
                        {formatShortTime(Math.round(row.duration), ['m', 's'], ' ') || '0s'}
                      </NumberCell>
                    </Grid>
                  </Link>
                );
              })}
            </Column>
          </Column>
        </Column>
      </LoadingPanel>
    </Column>
  );
}
