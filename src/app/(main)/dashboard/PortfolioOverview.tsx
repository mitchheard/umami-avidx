'use client';
import { useQueries } from '@tanstack/react-query';
import { Column, Grid, Heading, Row, StatusLight, Text } from '@umami/react-zen';
import { colord } from 'colord';
import { useCallback, useMemo } from 'react';
import { BarChart } from '@/components/charts/BarChart';
import { Empty } from '@/components/common/Empty';
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
import { renderDateLabels } from '@/lib/charts';
import { CHART_COLORS } from '@/lib/constants';
import { generateTimeSeries } from '@/lib/date';
import { formatLongNumber, formatShortTime } from '@/lib/format';

const MAX_WEBSITES = 100;
const ACTIVE_REFETCH_INTERVAL = 60000;
const ROW_COLUMNS = 'minmax(180px, 2fr) 140px repeat(5, minmax(64px, 1fr))';
// Below this many visitors in both periods a percentage change is just noise
const MIN_VISITORS_FOR_CHANGE = 3;

interface Website {
  id: string;
  name: string;
  domain: string;
}

function SiteTile({ name, color }: { name: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: 6,
        background: color,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function MiniBars({ values, color }: { values: number[]; color: string }) {
  // Scaled to the row's own peak: the chart above compares sites, this shows each site's shape
  const max = Math.max(0, ...values);
  const width = 120;
  const height = 32;

  if (!values.length || max === 0 || values.every(v => v === 0)) {
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

  const step = width / values.length;
  const barWidth = Math.max(step - 1, 1);

  return (
    <svg width={width} height={height} aria-hidden="true">
      {values.map((v, i) => {
        if (!v) return null;
        // Keep the smallest non-zero values visible
        const h = Math.max((v / max) * height, 2);

        return (
          <rect
            key={i}
            x={i * step}
            y={height - h}
            width={barWidth}
            height={h}
            fill={color}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function Cell({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <Text
      weight="medium"
      wrap="nowrap"
      color={muted ? 'muted' : undefined}
      style={{ textAlign: 'right' }}
    >
      {children}
    </Text>
  );
}

function OnlineCard({ label, value }: { label: string; value: number }) {
  return (
    <Column
      justifyContent="flex-start"
      paddingX="6"
      paddingY="4"
      borderRadius
      backgroundColor="surface-base"
      border
      gap="4"
    >
      <Text weight="bold" wrap="nowrap">
        {label}
      </Text>
      <Row alignItems="center" gap="3">
        <Text size="4xl" weight="bold" wrap="nowrap">
          {formatLongNumber(value)}
        </Text>
        {value > 0 && <StatusLight variant="success" />}
      </Row>
    </Column>
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
  const websites = websitesQuery.data?.data;

  const stats = useQueries({
    queries: (websites ?? []).map(({ id }) => ({
      queryKey: ['websites:stats', { websiteId: id, startAt, endAt }],
      queryFn: (): Promise<WebsiteStatsData> => get(`/websites/${id}/stats`, { startAt, endAt }),
    })),
  });

  const pageviews = useQueries({
    queries: (websites ?? []).map(({ id }) => ({
      queryKey: ['websites:pageviews', { websiteId: id, startAt, endAt, unit, timezone }],
      queryFn: (): Promise<WebsitePageviewsData> =>
        get(`/websites/${id}/pageviews`, { startAt, endAt, unit, timezone }),
    })),
  });

  const active = useQueries({
    queries: (websites ?? []).map(({ id }) => ({
      queryKey: ['websites:active', id],
      queryFn: (): Promise<{ visitors: number }> => get(`/websites/${id}/active`),
      refetchInterval: ACTIVE_REFETCH_INTERVAL,
    })),
  });

  // useQueries returns a new array every render, so memoize on when the data last changed
  const statsKey = stats.map(q => q.dataUpdatedAt).join();
  const pageviewsKey = pageviews.map(q => q.dataUpdatedAt).join();
  const activeKey = active.map(q => q.dataUpdatedAt).join();

  const rows = useMemo(() => {
    return (websites ?? [])
      .map((website, i) => {
        const s = stats[i]?.data;
        const visits = s?.visits ?? 0;

        return {
          ...website,
          // Colour follows the site, not its rank, so it stays put as traffic changes
          color: CHART_COLORS[i % CHART_COLORS.length],
          isLoading: !s,
          visitors: s?.visitors ?? 0,
          prevVisitors: s?.comparison?.visitors ?? 0,
          visits,
          pageviews: s?.pageviews ?? 0,
          bounceRate: visits ? (Math.min(visits, s.bounces) / visits) * 100 : 0,
          duration: visits ? s.totaltime / visits : 0,
          online: active[i]?.data?.visitors ?? 0,
          series: generateTimeSeries(
            pageviews[i]?.data?.pageviews ?? [],
            dateRange.startDate,
            dateRange.endDate,
            unit,
            locale,
          ),
        };
      })
      .sort((a, b) => b.visitors - a.visitors || b.pageviews - a.pageviews);
  }, [websites, statsKey, pageviewsKey, activeKey, dateRange, unit, locale]);

  const totals = useMemo(() => {
    const sum = (pick: (row: (typeof rows)[number]) => number) =>
      rows.reduce((n, row) => n + pick(row), 0);

    return {
      visitors: sum(r => r.visitors),
      prevVisitors: sum(r => r.prevVisitors),
      visits: sum(r => r.visits),
      pageviews: sum(r => r.pageviews),
      online: sum(r => r.online),
    };
  }, [rows]);

  const prevVisits = stats.reduce((n, q) => n + (q.data?.comparison?.visits ?? 0), 0);
  const prevPageviews = stats.reduce((n, q) => n + (q.data?.comparison?.pageviews ?? 0), 0);

  const chartData: any = useMemo(() => {
    const activeRows = rows.filter(row => row.pageviews > 0);

    return {
      __id: Date.now(),
      datasets: (activeRows.length ? activeRows : rows.slice(0, 1)).map(row => {
        const color = colord(row.color);

        return {
          label: row.name,
          data: row.series,
          backgroundColor: color.alpha(0.7).toRgbString(),
          borderColor: color.alpha(0.9).toRgbString(),
          borderWidth: 1,
          barPercentage: 0.9,
          categoryPercentage: 0.9,
        };
      }),
    };
  }, [rows]);

  const renderXLabel = useCallback(renderDateLabels(unit, locale), [unit, locale]);

  const statsLoading = stats.some(q => q.isLoading);
  const showChange = !isAllTime && !statsLoading;

  return (
    <Column gap="6" marginBottom="6">
      {showDateFilter && (
        <Row justifyContent="flex-end">
          <WebsiteDateFilter showAllTime={false} />
        </Row>
      )}
      <LoadingPanel
        data={websitesQuery.data}
        isEmpty={websites?.length === 0}
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
              showChange={showChange}
            />
            <MetricCard
              label={t(labels.visits)}
              value={totals.visits}
              change={totals.visits - prevVisits}
              formatValue={formatLongNumber}
              showChange={showChange}
            />
            <MetricCard
              label={t(labels.views)}
              value={totals.pageviews}
              change={totals.pageviews - prevPageviews}
              formatValue={formatLongNumber}
              showChange={showChange}
            />
            <OnlineCard label={t(labels.online)} value={totals.online} />
          </MetricsBar>

          <Column
            border
            borderRadius
            backgroundColor="surface-base"
            paddingX="6"
            paddingY="4"
            gap="4"
          >
            <Heading size="lg">{t(labels.views)}</Heading>
            <BarChart
              key={dateRange.value}
              chartData={chartData}
              minDate={dateRange.startDate}
              maxDate={dateRange.endDate}
              unit={unit}
              stacked={true}
              renderXLabel={renderXLabel}
              height="280px"
            />
          </Column>

          <Column border borderRadius backgroundColor="surface-base" style={{ overflowX: 'auto' }}>
            <Column style={{ minWidth: 820 }}>
              <Grid columns={ROW_COLUMNS} gap="4" paddingX="6" paddingY="4" alignItems="center">
                <Heading size="lg">{t(labels.websites)}</Heading>
                <span />
                {[
                  labels.visitors,
                  labels.visits,
                  labels.views,
                  labels.bounceRate,
                  labels.visitDuration,
                ].map(label => (
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
                ))}
              </Grid>
              {rows.map(row => {
                const change = row.visitors - row.prevVisitors;
                const isEmpty = !row.isLoading && row.visits === 0;
                const isNew = row.prevVisitors === 0 && row.visitors > 0;
                const hasMeaningfulChange =
                  row.prevVisitors > 0 &&
                  change !== 0 &&
                  Math.max(row.visitors, row.prevVisitors) >= MIN_VISITORS_FOR_CHANGE;

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
                      style={{ opacity: row.isLoading || isEmpty ? 0.5 : 1 }}
                    >
                      <Row alignItems="center" gap="3" style={{ minWidth: 0 }}>
                        <SiteTile name={row.name} color={row.color} />
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
                      <MiniBars values={row.series.map(({ y }) => y ?? 0)} color={row.color} />
                      <Row alignItems="center" justifyContent="flex-end" gap="3">
                        {showChange && !row.isLoading && isNew && (
                          <Text size="sm" color="muted" wrap="nowrap">
                            new
                          </Text>
                        )}
                        {showChange && !row.isLoading && hasMeaningfulChange && (
                          <ChangeLabel value={change} size="xs" alignSelf="center">
                            <Text size="sm">
                              {Math.abs(Math.round((change / row.prevVisitors) * 100))}%
                            </Text>
                          </ChangeLabel>
                        )}
                        <Cell>{formatLongNumber(row.visitors)}</Cell>
                      </Row>
                      <Cell>{formatLongNumber(row.visits)}</Cell>
                      <Cell>{formatLongNumber(row.pageviews)}</Cell>
                      <Cell muted={isEmpty}>
                        {isEmpty ? '–' : `${Math.round(row.bounceRate)}%`}
                      </Cell>
                      <Cell muted={isEmpty}>
                        {isEmpty
                          ? '–'
                          : formatShortTime(Math.round(row.duration), ['m', 's'], ' ') || '0s'}
                      </Cell>
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
