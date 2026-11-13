'use client';
import { Column } from '@umami/react-zen';
import { useEffect } from 'react';
import { BoardControls } from '@/app/(main)/boards/[boardId]/BoardControls';
import { BoardViewBody } from '@/app/(main)/boards/[boardId]/BoardViewBody';
import { PageBody } from '@/components/common/PageBody';
import { useBoard, useNavigation } from '@/components/hooks';
import { getBoardEntity, getFirstBoardComponentEntity } from '@/lib/boards';
import { DashboardProvider } from './DashboardProvider';
import { DashboardViewHeader } from './DashboardViewHeader';
import { PortfolioOverview } from './PortfolioOverview';

function DashboardContent() {
  const { board } = useBoard();
  const rows = board?.parameters?.rows ?? [];
  const hasComponents = rows.some(row => row.columns?.some(column => !!column.component));
  // BoardControls renders its own date filter once the dashboard has an entity
  const hasBoardControls = !!(
    getBoardEntity(board).entityId || getFirstBoardComponentEntity(board).entityId
  );

  return (
    <>
      <PortfolioOverview showDateFilter={!hasBoardControls} />
      {hasComponents && <BoardViewBody />}
    </>
  );
}

export function DashboardViewPage() {
  const { teamId, router } = useNavigation();

  useEffect(() => {
    if (teamId) {
      router.replace('/dashboard');
    }
  }, [teamId, router]);

  if (teamId) {
    return null;
  }

  return (
    <DashboardProvider>
      <PageBody>
        <Column>
          <DashboardViewHeader />
          <BoardControls />
          <DashboardContent />
        </Column>
      </PageBody>
    </DashboardProvider>
  );
}
