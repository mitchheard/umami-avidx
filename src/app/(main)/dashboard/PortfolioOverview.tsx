'use client';
import { useQueries } from '@tanstack/react-query';
import { Column, Grid, Heading, Row, StatusLight, Text } from '@umami/react-zen';
import { colord } from 'colord';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart } from '@/components/charts/BarChart';
import { Empty } from '@/components/common/Empty';
import { Favicon } from '@/components/common/Favicon';
import Link from '@/components/common/Link';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { TypeIcon } from '@/components/common/TypeIcon';
import {
  useApi,
  useDateParameters,
  useDateRange,
  useFormat,
  useLocale,
  useMessages,
  useNavigation,
} from '@/components/hooks';
import type { WebsitePageviewsData } from '@/components/hooks/queries/useWebsitePageviewsQuery';
import type { WebsiteStatsData } from '@/components/hooks/queries/useWebsiteStatsQuery';
import { WebsiteDateFilter } from '@/components/input/WebsiteDateFilter';
import { ChangeLabel } from '@/components/metrics/ChangeLabel';
import { ListTable } from '@/components/metrics/ListTable';
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
// A few visitors per site per day is mostly noise, so this page opens on a week
const DEFAULT_DATE_RANGE = '7day';
const SOURCE_TYPES = ['referrer', 'country'] as const;
const SOURCE_FETCH_LIMIT = 20;
const SOURCE_ROWS = 8;
// Marks the estimated direct-traffic row in the referrers table
const DIRECT = '(direct)';
// Hosts people return from after signing in, e.g. accounts.google.com
const SIGN_IN_REFERRER = /^(accounts|login|signin|auth|sso|appleid)\./i;

type SortKey = 'name' | 'visitors' | 'visits' | 'pageviews' | 'bounceRate' | 'duration';

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
          stroke="var(--zen-fg-muted)"
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

function SortHeader({
  active,
  desc,
  align = 'right',
  onClick,
  children,
}: {
  active: boolean;
  desc: boolean;
  align?: 'left' | 'right';
  onClick: () => void;
  children: ReactNode;
}) {
  const arrow = active && (
    <span aria-hidden="true" style={{ fontSize: 11 }}>
      {desc ? '↓' : '↑'}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        gap: 4,
        padding: 0,
        border: 0,
        background: 'none',
        color: active ? 'inherit' : 'var(--zen-fg-muted)',
        font: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Right-aligned headers put the arrow first so the label stays flush with the numbers below */}
      {align === 'right' && arrow}
      {children}
      {align === 'left' && arrow}
    </button>
  );
}

function OnlineCard({ label, value }: { label: string; value: number }) {
  return (
    <Column
      justifyContent="flex-start"
      paddingX="6"
      paddingY="4"
      borderRadius
      backgroundColor="surface"
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

function PortfolioOverviewContent({ showDateFilter = true }: { showDateFilter?: boolean }) {
  const { get, useQuery } = useApi();
  const { t, labels } = useMessages();
  const { locale } = useLocale();
  const { formatValue } = useFormat();
  const { renderUrl } = useNavigation();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: 'visitors',
    desc: true,
  });
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

  // Only ask for sources from sites that had traffic in the period
  const metrics = useQueries({
    queries: (websites ?? []).flatMap(({ id }, i) =>
      SOURCE_TYPES.map(type => ({
        queryKey: [
          'websites:metrics',
          { websiteId: id, type, startAt, endAt, limit: SOURCE_FETCH_LIMIT },
        ],
        queryFn: (): Promise<{ x: string; y: number }[]> =>
          get(`/websites/${id}/metrics`, { type, startAt, endAt, limit: SOURCE_FETCH_LIMIT }),
        enabled: (stats[i]?.data?.visits ?? 0) > 0,
      })),
    ),
  });
  const metricsKey = metrics.map(q => q.dataUpdatedAt).join();

  const sources = useMemo(() => {
    const referrers = new Map<string, number>();
    const countries = new Map<string, number>();
    let direct = 0;

    (websites ?? []).forEach((_, site) => {
      const [referrerQuery, countryQuery] = SOURCE_TYPES.map(
        (_type, t) => metrics[site * SOURCE_TYPES.length + t],
      );
      let referred = 0;

      for (const { x, y } of referrerQuery?.data ?? []) {
        // Empty referrers and returns from a login page are not places that sent traffic
        if (!x || SIGN_IN_REFERRER.test(x)) continue;

        referrers.set(x, (referrers.get(x) ?? 0) + y);
        referred += y;
      }

      for (const { x, y } of countryQuery?.data ?? []) {
        countries.set(x ?? '', (countries.get(x ?? '') ?? 0) + y);
      }

      // Umami doesn't report direct traffic, so estimate it as whoever is left over
      if (referrerQuery?.data) {
        direct += Math.max((stats[site]?.data?.visitors ?? 0) - referred, 0);
      }
    });

    if (direct > 0) {
      referrers.set(DIRECT, direct);
    }

    const [referrer, country] = [referrers, countries].map(counts => {
      const total = [...counts.values()].reduce((n, y) => n + y, 0);

      return [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, SOURCE_ROWS)
        .map(([label, count]) => ({ label, count, percent: total ? (count / total) * 100 : 0 }));
    });

    return { referrer, country };
  }, [websites, metricsKey, statsKey]);

  // Sites with no visits stay at the bottom whichever column is sorted
  const tableRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aEmpty = a.visits === 0;
      const bEmpty = b.visits === 0;

      if (aEmpty !== bEmpty) {
        return aEmpty ? 1 : -1;
      }

      const diff = sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];

      return (sort.desc ? -diff : diff) || b.visitors - a.visitors;
    });
  }, [rows, sort]);

  const handleSort = (key: SortKey) => {
    // Names start A to Z, numbers start largest first; clicking again flips
    setSort(current =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'name' },
    );
  };

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
          <MetricsBar joined={false}>
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

          <Column border borderRadius backgroundColor="surface" paddingX="6" paddingY="4" gap="4">
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

          <Column border borderRadius backgroundColor="surface" style={{ overflowX: 'auto' }}>
            <Column style={{ minWidth: 820 }}>
              <Grid columns={ROW_COLUMNS} gap="4" paddingX="6" paddingY="4" alignItems="center">
                <SortHeader
                  align="left"
                  active={sort.key === 'name'}
                  desc={sort.desc}
                  onClick={() => handleSort('name')}
                >
                  <Heading size="lg">{t(labels.websites)}</Heading>
                </SortHeader>
                <span />
                {(
                  [
                    ['visitors', labels.visitors],
                    ['visits', labels.visits],
                    ['pageviews', labels.views],
                    ['bounceRate', labels.bounceRate],
                    ['duration', labels.visitDuration],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <SortHeader
                    key={key}
                    active={sort.key === key}
                    desc={sort.desc}
                    onClick={() => handleSort(key)}
                  >
                    <Text size="sm" weight="bold" wrap="nowrap">
                      {t(label)}
                    </Text>
                  </SortHeader>
                ))}
              </Grid>
              {tableRows.map(row => {
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

          <Grid columns={{ base: '1fr', md: '1fr 1fr' }} gap="6">
            <Column border borderRadius backgroundColor="surface" paddingX="6" paddingY="4">
              <ListTable
                title={t(labels.referrers)}
                metric={t(labels.visitors)}
                data={sources.referrer}
                renderLabel={({ label }) => (
                  <Row alignItems="center" gap="3">
                    {label !== DIRECT && <Favicon domain={label} />}
                    {label === DIRECT ? t(labels.direct) : label}
                  </Row>
                )}
              />
            </Column>
            <Column border borderRadius backgroundColor="surface" paddingX="6" paddingY="4">
              <ListTable
                title={t(labels.countries)}
                metric={t(labels.visitors)}
                data={sources.country}
                renderLabel={({ label }) => (
                  <TypeIcon type="country" value={label}>
                    {formatValue(label, 'country')}
                  </TypeIcon>
                )}
              />
            </Column>
          </Grid>
        </Column>
      </LoadingPanel>
    </Column>
  );
}

export function PortfolioOverview(props: { showDateFilter?: boolean }) {
  const searchParams = useSearchParams();
  const { router, updateParams } = useNavigation();
  const hasDate = !!searchParams.get('date');

  useEffect(() => {
    if (!hasDate) {
      router.replace(updateParams({ date: DEFAULT_DATE_RANGE }));
    }
  }, [hasDate, router, updateParams]);

  // Wait for the default range to land in the URL so data isn't fetched twice
  if (!hasDate) {
    return null;
  }

  return <PortfolioOverviewContent {...props} />;
}
